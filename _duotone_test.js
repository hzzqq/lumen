// Lumen 双色调(Duotone)纯函数忠实移植测试：对应 GLSL uDuotone 分支
// c_t = clamp(c + (clamp(mix(shadow, high, lum(c))) - c) * t, 0, 1)
const cl = x => Math.max(0, Math.min(1, x));
function applyDuotone(c, t){
  const sh = [0.05, 0.0, 0.1], hi = [1.0, 0.9, 0.7];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const dt = [0,1,2].map(i => cl(sh[i] + (hi[i] - sh[i]) * l));
  return [0,1,2].map(i => cl(c[i] + (dt[i] - c[i]) * t));
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-9)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等(中灰)', eq3(applyDuotone([0.5,0.5,0.5], 0), [0.5,0.5,0.5]));
ok('t=0 恒等(红)', eq3(applyDuotone([1,0,0], 0), [1,0,0]));
// t=1 完全双色调
ok('t=1 黑→暗部色', eq3(applyDuotone([0,0,0], 1), [0.05,0.0,0.1]));
ok('t=1 白→高光色', eq3(applyDuotone([1,1,1], 1), [1.0,0.9,0.7]));
ok('t=1 中灰→插值', eq3(applyDuotone([0.5,0.5,0.5], 1), [0.525,0.45,0.4]));
// t=0.5 半插值
ok('t=0.5 半插值(中灰)', eq3(applyDuotone([0.5,0.5,0.5], 0.5), [0.5125,0.475,0.45]));
// 亮度单调：越亮输入双色调后越亮(高光色>暗部色)
{
  const dark = applyDuotone([0,0,0], 1);
  const light = applyDuotone([1,1,1], 1);
  ok('双色调亮度单调(逐通道)', light[0] > dark[0] && light[1] > dark[1] && light[2] > dark[2]);
}
// 钳制：超出 [0,1] 被夹回
ok('输入越界仍钳制(1.5→1)', applyDuotone([1.5,1.5,1.5], 1)[0] <= 1.0);
// 所有分量在 [0,1]
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyDuotone(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

console.log(`\n[Lumen duotone] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
