// Lumen 曝光(Expose)纯函数忠实移植测试：对应 GLSL uExpose 分支
// 按 2^t 倍率整体提亮(曝光补偿)：c' = c * 2^t（GLSL 侧最后 clamp 到 [0,1]）
function applyExpose(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const k = Math.pow(2, t);
  return [c[0]*k, c[1]*k, c[2]*k];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);
const SQ = Math.SQRT2;

// t=0 恒等
ok('t=0 恒等', eq3(applyExpose([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// t=1 提亮一倍：0.5 -> 1.0
ok('t=1 [0.5,0.5,0.5] => [1,1,1]', eq3(applyExpose([0.5,0.5,0.5], 1), [1,1,1]));
// t=1 多通道：[0.25,0.5,0.75] => [0.5,1,1.5]
ok('t=1 [0.25,0.5,0.75] => [0.5,1,1.5]', eq3(applyExpose([0.25,0.5,0.75], 1), [0.5,1,1.5]));
// t=0.5 为 √2 倍
ok('t=0.5 [0.5,0.5,0.5] => [√2/2,..]', eq3(applyExpose([0.5,0.5,0.5], 0.5), [0.5*SQ,0.5*SQ,0.5*SQ]));
// t=2 为 4 倍：[0.1,0.2,0.3] => [0.4,0.8,1.2]
ok('t=2 [0.1,0.2,0.3] => [0.4,0.8,1.2]', eq3(applyExpose([0.1,0.2,0.3], 2), [0.4,0.8,1.2]));
// 单调：t 越大整体越亮
ok('t 越大越亮', applyExpose([0.5,0.5,0.5], 1)[0] > applyExpose([0.5,0.5,0.5], 0.2)[0]);
// t>0 仅提亮(各通道 >= 原值)
{
  let brightenOnly = true;
  for(const tt of [0.25,0.5,0.75,1,2]){
    const o = [0.1,0.4,0.9], r = applyExpose(o, tt);
    if(!(r[0] >= o[0]-1e-9 && r[1] >= o[1]-1e-9 && r[2] >= o[2]-1e-9)) brightenOnly = false;
  }
  ok('t>0 仅提亮不压暗', brightenOnly);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uExpose uniform', /uniform float uExpose;/.test(src));
ok('main.js 含 uExpose GLSL 分支', /if\(uExpose > 0\.0\)\{/.test(src));
ok('main.js 绑定 uExpose uniform', /gl\.uniform1f\(u\(showProg,'uExpose'\), expose\);/.test(src));
ok('presetToParams 含 expose (p.)', /expose: num\(p\.expose, 0\)/.test(src));
ok('serializeScene 含 expose', /expose: num\('expose', 0\)/.test(src));
ok('state 默认 expose=0', /, expose=0,/.test(src));
ok('applyPreset 赋值 expose', /expose=s\.expose;/.test(src));
ok('index.html 含 expose 滑块', /id="expose"/.test(html));
ok('index.html 含 exposeVal 显示', /id="exposeVal"/.test(html));

console.log(`\n[Lumen expose] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
