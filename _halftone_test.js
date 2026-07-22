// Lumen 半调网点(Halftone) 后处理单元测试：纯函数移植 + 全链路接线断言
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：与 GLSL 分支一致 ----
function applyHalftone(c, uv, t){
  // c: [r,g,b] in 0..1；uv: [u,v] in 0..1；t: 0=原图, 1=满半调（与 GLSL 一致：亮=纸白 暗=墨点）
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const cells = 40 + (120 - 40) * t;            // mix(40,120,t)
  const gx = (uv[0]*cells) - Math.floor(uv[0]*cells) - 0.5;
  const gy = (uv[1]*cells) - Math.floor(uv[1]*cells) - 0.5;
  const ang = 0.5236;                            // 30°
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rgx = ca*gx + sa*gy;                     // mat2(c,-s,s,c)*g
  const rgy = -sa*gx + ca*gy;
  const d = Math.hypot(rgx, rgy);
  const radius = (1 - l) * 0.7071;
  // smoothstep(radius-0.06, radius+0.06, d)
  let tt = (d - (radius - 0.06)) / ((radius + 0.06) - (radius - 0.06));
  tt = Math.max(0, Math.min(1, tt));
  const ink = tt*tt*(3 - 2*tt);
  return [c[0] + (ink - c[0]) * t, c[1] + (ink - c[1]) * t, c[2] + (ink - c[2]) * t];
}

// ---- 行为正确性 ----
ok('t=0 恒等(原图)', (()=>{ const r = applyHalftone([0.2,0.5,0.8], [0.1,0.2], 0); return JSON.stringify(r) === JSON.stringify([0.2,0.5,0.8]); })());
ok('亮部(l=1) 半调后趋于白', (()=>{ const r = applyHalftone([1,1,1], [0.0,0.0], 1); return r[0] > 0.9 && r[1] > 0.9 && r[2] > 0.9; })());
ok('暗部(l=0) 单元中心趋于黑', (()=>{ const r = applyHalftone([0,0,0], [0.5,0.5], 1); return r[0] < 0.6 && r[1] < 0.6 && r[2] < 0.6; })());
ok('输出范围 0..1', (()=>{ for(const l of [0,0.25,0.5,0.75,1]) for(const uv of [[0,0],[0.5,0.5],[0.25,0.75]]) { const r = applyHalftone([l,l,l], uv, 1); if(r.some(x=>x<0||x>1)) return false; } return true; })());
ok('越亮越白(同 uv 比较)', (()=>{ const dark = applyHalftone([0,0,0],[0.5,0.5],1)[0]; const bright = applyHalftone([1,1,1],[0.5,0.5],1)[0]; return bright > dark; })());

// ---- 全链路接线（子串存在性）----
ok('GLSL 声明 uniform float uHalftone', /uniform float uHalftone;/.test(main));
ok('GLSL 链路含 uHalftone>0 分支', /if\(uHalftone > 0\.0\)/.test(main));
ok('GLSL 使用点阵 smoothstep', /smoothstep\(radius - 0\.06, radius \+ 0\.06, d\)/.test(main));
ok('state 默认含 halftone=0', /halftone=0[,;]/.test(main));
ok('serialize 含 halftone: s.halftone', /halftone: s\.halftone/.test(main));
ok('deserialize 含 halftone: num', /halftone: num\('halftone', 0\)/.test(main));
ok('presetToParams 含 halftone', /halftone: num\(p\.halftone, 0\)/.test(main));
ok('applyPreset/loadScene 含 halftone=s.halftone', /halftone=s\.halftone;/.test(main));
ok('syncSceneUI 含 halftone 滑块同步', /\$\('halftone'\)\.value = Math\.round\(halftone \* 100\)/.test(main));
ok('uniform 绑定 uHalftone', /u\(showProg,'uHalftone'\)/.test(main));
ok('UI oninput 接线 halftone', /\$\('halftone'\)\.oninput/.test(main));
ok('index.html 含 halftone 滑块', /id="halftone"/.test(html));
ok('exportScene 调用传入 halftone(修复漏传 bug)', /serializeScene\(\{[\s\S]*halftone\b/.test(main));
ok('presetToParams 字段数 75(含 halftone)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); const s=f({}); return typeof s.halftone === 'number'; })());

console.log(`\n[Lumen halftone] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
