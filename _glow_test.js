// Lumen 柔光(Glow)纯函数忠实移植测试：对应 GLSL uGlow 分支
// 仅对亮度 > 0.6 的高亮区按自身色相增强(伪 bloom)：g = max(l-0.6,0)/0.4; c += t*g*c
function applyGlow(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const g = Math.max(l - 0.6, 0) / 0.4;
  const k = 1 + t * g;
  return [c[0]*k, c[1]*k, c[2]*k];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyGlow([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 暗部不受影响(luma<0.6 => g=0 => 不变)
ok('暗色 [0.1,0.2,0.3] t=1 不变', eq3(applyGlow([0.1,0.2,0.3], 1), [0.1,0.2,0.3]));
// 中灰(0.5) 不受影响
ok('中灰 [0.5,0.5,0.5] t=1 不变', eq3(applyGlow([0.5,0.5,0.5], 1), [0.5,0.5,0.5]));
// t=1 亮色被增强（超过阈值部分提亮）：[0.9,0.9,0.9] luma=0.9, g=0.75, k=1.75 => [1.575,...]
ok('t=1 亮色 [0.9,0.9,0.9] => [1.575,1.575,1.575]', eq3(applyGlow([0.9,0.9,0.9], 1), [1.575,1.575,1.575]));
// t=0.5 半插值：g=0.75, k=1.375 => [1.2375,...]
ok('t=0.5 [0.9,0.9,0.9] => [1.2375,1.2375,1.2375]', eq3(applyGlow([0.9,0.9,0.9], 0.5), [1.2375,1.2375,1.2375]));
// 亮色越亮增强越多：纯白 g=1, k=1+t
ok('t=1 纯白 [1,1,1] => [2,2,2]', eq3(applyGlow([1,1,1], 1), [2,2,2]));
// 单调：t 越大高亮增强越多
ok('t 越大亮色增强越多', applyGlow([0.9,0.9,0.9], 1)[0] > applyGlow([0.9,0.9,0.9], 0.2)[0]);
// 仅作用于高光：暗部(0.1,0.2,0.3)在任意 t 下不变
{
  let darkStable = true;
  for(const t of [0,0.25,0.5,0.75,1]) if(!eq3(applyGlow([0.1,0.2,0.3], t), [0.1,0.2,0.3])) darkStable = false;
  ok('暗部在任何强度下均不变', darkStable);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uGlow uniform', /uniform float uGlow;/.test(src));
ok('main.js 含 uGlow GLSL 分支', /if\(uGlow > 0\.0\)\{/.test(src));
ok('main.js 绑定 uGlow uniform', /gl\.uniform1f\(u\(showProg,'uGlow'\), glow\);/.test(src));
ok('presetToParams 含 glow', /glow: num\(p\.glow, 0\)/.test(src));
ok('index.html 含 glow 滑块', /id="glow"/.test(html));
ok('index.html 含 glowVal 显示', /id="glowVal"/.test(html));

console.log(`\n[Lumen glow] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
