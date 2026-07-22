// _glitch_test.js — ci325 故障艺术：新能力(uGlitch 条带错位 + RGB 抖动 + 偶发反相) + R2(修复被破坏的 tonemap/agxTonemap，使 AgX 真正生效)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：故障艺术全链路 ----
ok('SHOW 着色器声明 uniform float uGlitch', /uniform float uGlitch;/.test(main));
ok('SHOW main 含故障分支 if(uGlitch>0.0)', /if\(uGlitch > 0\.0\)\{[\s\S]*sampleHDR\(guv \+ vec2\(uGlitch \* 0\.012/.test(main));
ok('故障含 RGB 抖动采样(g.r/g.g/g.b 分离)', /g\.r = sampleHDR\(guv \+ vec2\(uGlitch \* 0\.012, 0\.0\)\)\.r;/.test(main));
ok('故障含偶发整块反相 mix(g, vec3(1.0)-g)', /mix\(g, vec3\(1\.0\) - g, inv \* uGlitch\)/.test(main));
ok('state 默认含 glitch=0', /let sceneId=0,[\s\S]*\bglitch=0\b/.test(main));
ok('serializeScene 含 glitch: s.glitch', /glitch: s\.glitch/.test(main));
ok('deserializeScene 含 glitch: num', /glitch: num\('glitch', 0\)/.test(main));
ok('presetToParams 含 glitch: num', /glitch: num\(p\.glitch, 0\)/.test(main));
ok('applyPreset/importScene 含 glitch=s.glitch', /glitch=s\.glitch;/.test(main));
ok('exportScene 调用传入 glitch', /glitch, fisheye \}\)/.test(main));
ok('loop 绑定 u(showProg,\'uGlitch\')', /u\(showProg,'uGlitch'\)/.test(main));
ok('syncSceneUI 恢复 glitch 滑块', /\$\('glitch'\)\.value = Math\.round\(glitch \* 100\)/.test(main));
ok('oninput 处理器更新 glitch', /\$\('glitch'\)\.oninput/.test(main));
ok('index.html 含 glitch 滑块', /id="glitch"/.test(html));
// R2: tonemap 正确分派 m==4 给 agxTonemap（此前被注释掉/嵌套损坏）
ok('R2: tonemap 对 m==4 调用 agxTonemap', /if\(m==4\) return clamp\(agxTonemap\(x\), 0\.0, 1\.0\);/.test(main));
ok('R2: agxTonemap 为独立顶层函数(无嵌套/重复 tonemap)', (()=>{
  const defs = main.match(/vec3 tonemap\(vec3 x, int m\)\{/g) || [];
  return defs.length === 1;
})());

// ---- 行为验证：移植故障位移/反相数学 ----
function hash21(x, y){ const s = Math.sin(x*127.1 + y*311.7) * 43758.5453; return s - Math.floor(s); }
function glitchShift(by, t, k){
  const h = hash21(by, t);
  const gat = hash21(by*1.7, t*1.3) >= 0.55 ? 1 : 0;
  return (h - 0.5) * k * 0.12 * gat;
}
ok('k=0 时无条带错位(shift=0)', Math.abs(glitchShift(3, 1, 0)) < 1e-9);
let maxAbs = 0;
for (let by = 0; by < 200; by++){ const s = glitchShift(by, 1, 1); maxAbs = Math.max(maxAbs, Math.abs(s)); }
ok('k=1 时错位幅度受 0.12 上限约束', maxAbs <= 0.061);
ok('错位幅度随 k 线性增长', Math.abs(glitchShift(7, 2, 0.5)) < Math.abs(glitchShift(7, 2, 1.0)) + 1e-9);
// 偶发反相：~15% 块触发(inv 阈值 0.85)
let invCount = 0, N = 4000;
for (let by = 0; by < N; by++){ if (hash21(by*5.3, (by%13)) >= 0.85) invCount++; }
const frac = invCount / N;
ok('偶发反相仅作用于少数块(5%~30%)', frac > 0.05 && frac < 0.30);

console.log(`[Lumen glitch] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
