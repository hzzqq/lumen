// Lumen 反相/负片(Invert) 后处理单元测试：纯函数移植 + 全链路接线断言
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：反相 mix(c, 1-c, t) ----
function invertFactor(){ return 1; } // 占位（保持与 scanline 测试同构）
function applyInvert(c, t){
  // c: [r,g,b] in 0..1；t: 0=原色, 1=完全反相
  return [c[0] + (1 - c[0] - c[0]) * t, c[1] + (1 - c[1] - c[1]) * t, c[2] + (1 - c[2] - c[2]) * t];
}

// ---- 行为正确性 ----
ok('t=0 恒等', (()=>{ const r = applyInvert([0.2,0.5,0.8], 0); return JSON.stringify(r) === JSON.stringify([0.2,0.5,0.8]); })());
ok('t=1 完全反相', (()=>{ const r = applyInvert([0.2,0.5,0.8], 1); return Math.abs(r[0]-0.8)<1e-9 && Math.abs(r[1]-0.5)<1e-9 && Math.abs(r[2]-0.2)<1e-9; })());
ok('t=0.5 中灰不变', (()=>{ const r = applyInvert([0.5,0.5,0.5], 0.5); return Math.abs(r[0]-0.5)<1e-9 && Math.abs(r[1]-0.5)<1e-9 && Math.abs(r[2]-0.5)<1e-9; })());
ok('t=0.5 任意输入映射到中灰 0.5', (()=>{ const r = applyInvert([0.2,0.3,0.4], 0.5); return Math.abs(r[0]-0.5)<1e-6 && Math.abs(r[1]-0.5)<1e-6 && Math.abs(r[2]-0.5)<1e-6; })());
ok('反相后范围仍在 0..1', (()=>{ for(const v of [0,0.25,0.5,0.75,1]){ const r = applyInvert([v,v,v], 0.3); if(r.some(x=>x<0||x>1)) return false; } return true; })());

// ---- 全链路接线（子串存在性，新增字段不破坏既有断言）----
ok('GLSL 声明 uniform float uInvert', /uniform float uInvert;/.test(main));
ok('GLSL 链路含 uInvert>0 分支', /if\(uInvert > 0\.0\)/.test(main));
ok('GLSL 使用 mix(c, vec3(1.0) - c, uInvert)', /mix\(c, vec3\(1\.0\) - c, uInvert\)/.test(main));
ok('state 默认含 invert=0', /invert=0[,;]/.test(main));
ok('serialize 含 invert: s.invert', /invert: s\.invert/.test(main));
ok('deserialize 含 invert: num', /invert: num\('invert', 0\)/.test(main));
ok('presetToParams 含 invert', /invert: num\(p\.invert, 0\)/.test(main));
ok('applyPreset/loadScene 含 invert=s.invert', /invert=s\.invert;/.test(main));
ok('syncSceneUI 含 invert 滑块同步', /\$\('invert'\)\.value = Math\.round\(invert \* 100\)/.test(main));
ok('uniform 绑定 uInvert', /u\(showProg,'uInvert'\)/.test(main));
ok('UI oninput 接线 invert', /\$\('invert'\)\.oninput/.test(main));
ok('index.html 含 invert 滑块', /id="invert"/.test(html));
ok('presetToParams 字段数 57(含 invert/border/bright/duotone/vibrance/mono/tint/balance/bleach/fade/splittone)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); return Object.keys(f({})).length === 57; })());

console.log(`\n[Lumen invert] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
