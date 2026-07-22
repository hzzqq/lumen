// Lumen 色调分离(Solarize)纯函数忠实移植测试：对应 GLSL uSolarize 分支
// 仅对亮度 > 0.5 的像素按强度反相：mix(c, 1-c, t) => c + t*(1-2c)
function applySolarize(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  if(l > 0.5){ const k = t; return [c[0] + k*(1 - 2*c[0]), c[1] + k*(1 - 2*c[1]), c[2] + k*(1 - 2*c[2])]; }
  return [c[0], c[1], c[2]];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applySolarize([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 暗部(luma<=0.5)不受影响
ok('暗色 [0.1,0.2,0.3] t=1 不变', eq3(applySolarize([0.1,0.2,0.3], 1), [0.1,0.2,0.3]));
// 中灰(luma=0.5, 严格大于才反相)不变
ok('中灰 [0.5,0.5,0.5] t=1 不变', eq3(applySolarize([0.5,0.5,0.5], 1), [0.5,0.5,0.5]));
// t=1 亮色被完全反相
ok('t=1 亮色 [0.9,0.9,0.9] => [0.1,0.1,0.1]', eq3(applySolarize([0.9,0.9,0.9], 1), [0.1,0.1,0.1]));
// t=0.5 半反相：[0.9,0.9,0.9] => 0.9+0.5*(1-1.8)=0.9-0.4=0.5
ok('t=0.5 [0.9,0.9,0.9] => [0.5,0.5,0.5]', eq3(applySolarize([0.9,0.9,0.9], 0.5), [0.5,0.5,0.5]));
// 单调：t 越大亮色反得越多(亮度>0.5 时分量随 t 递减)
ok('t 越大亮色分量越小', applySolarize([0.8,0.8,0.8], 1)[0] < applySolarize([0.8,0.8,0.8], 0.2)[0]);
// 反相仅作用于亮部：暗部在任意 t 下不变
{
  let darkStable = true;
  for(const t of [0,0.25,0.5,0.75,1]) if(!eq3(applySolarize([0.1,0.2,0.3], t), [0.1,0.2,0.3])) darkStable = false;
  ok('暗部在任何强度下均不变', darkStable);
}
// 输出恒在 [0,1]（mix 在 [0,1] 区间）
{
  let inRange = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5],[0.6,0.6,0.6]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applySolarize(c,t)) if(v < -1e-9 || v > 1+1e-9) inRange = false;
  ok('任意输入/强度输出均在 [0,1]', inRange);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uSolarize uniform', /uniform float uSolarize;/.test(src));
ok('main.js 含 uSolarize GLSL 分支', /if\(uSolarize > 0\.0\)\{/.test(src));
ok('main.js 绑定 uSolarize uniform', /gl\.uniform1f\(u\(showProg,'uSolarize'\), solarize\);/.test(src));
ok('presetToParams 含 solarize', /solarize: num\(p\.solarize, 0\)/.test(src));
ok('index.html 含 solarize 滑块', /id="solarize"/.test(html));
ok('index.html 含 solarizeVal 显示', /id="solarizeVal"/.test(html));

console.log(`\n[Lumen solarize] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
