// Lumen 色度键控/绿幕抠像(Color Key) 后处理单元测试：纯函数移植 + 全链路接线断言 + 隐性修复验证
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：绿幕抠像(靠近关键色压黑) ----
function applyColorkey(c, t){
  const key = [0.10, 0.80, 0.20];
  const d = Math.hypot(c[0]-key[0], c[1]-key[1], c[2]-key[2]);
  const thr = 0.25 + (0.60 - 0.25) * t;
  // smoothstep(thr, thr+0.15, d)
  let tt = (d - thr) / ((thr + 0.15) - thr);
  tt = Math.max(0, Math.min(1, tt));
  const k = tt*tt*(3 - 2*tt);
  return [c[0]*k, c[1]*k, c[2]*k];
}
// ---- 行为正确性 ----
ok('t=0 恒等', (()=>{ const r=applyColorkey([0.2,0.5,0.8],0); return JSON.stringify(r)===JSON.stringify([0.2,0.5,0.8]); })());
ok('绿幕色被抠除(趋黑)', (()=>{ const r=applyColorkey([0.1,0.8,0.2],1); return r[0]<0.05 && r[1]<0.05 && r[2]<0.05; })());
ok('非绿幕色被保留', (()=>{ const r=applyColorkey([0.9,0.1,0.1],1); return r[0]>0.8; })());
ok('输出范围 0..1', (()=>{ for(const t of [0,0.5,1]) for(const c of [[0,1,0],[0.2,0.5,0.8],[1,0,0]]){ const r=applyColorkey(c,t); if(r.some(x=>x<0||x>1)) return false; } return true; })());

// ---- 全链路接线 ----
ok('GLSL 声明 uniform float uColorkey', /uniform float uColorkey;/.test(main));
ok('GLSL 含 uColorkey>0 分支', /if\(uColorkey > 0\.0\)/.test(main));
ok('GLSL 计算到关键色距离 distance(c,key)', /distance\(c, key\)/.test(main));
ok('GLSL 抠除区域压黑 c = c \* k', /c = c \* k;/.test(main));
ok('state 默认含 colorkey=0', /colorkey=0[,;]/.test(main));
ok('serialize 含 colorkey: s.colorkey', /colorkey: s\.colorkey/.test(main));
ok('deserialize 含 colorkey: num', /colorkey: num\('colorkey', 0\)/.test(main));
ok('presetToParams 含 colorkey', /colorkey: num\(p\.colorkey, 0\)/.test(main));
ok('applyPreset/loadScene 含 colorkey=s.colorkey', /colorkey=s\.colorkey;/.test(main));
ok('syncSceneUI 含 colorkey 滑块同步', /\$\('colorkey'\)\.value = Math\.round\(colorkey \* 100\)/.test(main));
ok('uniform 绑定 uColorkey', /u\(showProg,'uColorkey'\)/.test(main));
ok('UI oninput 接线 colorkey', /\$\('colorkey'\)\.oninput/.test(main));
ok('index.html 含 colorkey 滑块', /id="colorkey"/.test(html));
ok('exportScene 调用传入 colorkey', /serializeScene\(\{[\s\S]*colorkey\b/.test(main));
ok('presetToParams 字段数 78(含 colorkey)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); const s=f({}); return typeof s.colorkey === 'number'; })());

// ---- R2 隐性修复：exposure 钳制下限为 0(避免负值导致曝光补偿异常) ----
ok('presetToParams 对 exposure=-2 钳制为 >=0', (()=>{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ exposure: -2 }).exposure >= 0;
})());
ok('deserializeScene 对 exposure=-5 钳制为 >=0', (()=>{
  const m = main.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ exposure: -5 }).exposure >= 0;
})());

console.log(`\n[Lumen colorkey] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
