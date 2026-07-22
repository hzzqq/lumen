// Lumen 色彩平衡(Balance)纯函数忠实移植测试：对应 GLSL uBalance 分支
// b = 2t-1；>0 偏暖(红增蓝减)、<0 偏冷(红减蓝增)、=0 不变；t<=0 整体无效。
function applyBalance(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const b = t * 2 - 1;
  return [
    Math.max(0, Math.min(1, c[0] + 0.15 * b)),
    c[1],
    Math.max(0, Math.min(1, c[2] - 0.15 * b))
  ];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-9)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyBalance([0.5,0.5,0.5], 0), [0.5,0.5,0.5]));
// t=0.5 → b=0 恒等
ok('t=0.5 恒等(b=0)', eq3(applyBalance([0.3,0.7,0.2], 0.5), [0.3,0.7,0.2]));
// t=1 暖：r+0.15, b-0.15
ok('t=1 暖 [0.5,0.5,0.5] => [0.65,0.5,0.35]', eq3(applyBalance([0.5,0.5,0.5], 1), [0.65,0.5,0.35]));
// t=0.75 暖(b=0.5)：r+0.075, b-0.075
ok('t=0.75 暖 [0.5,0.5,0.5] => [0.575,0.5,0.425]', eq3(applyBalance([0.5,0.5,0.5], 0.75), [0.575,0.5,0.425]));
// t=0.25 冷(b=-0.5)：r-0.075, b+0.075
ok('t=0.25 冷 [0.5,0.5,0.5] => [0.425,0.5,0.575]', eq3(applyBalance([0.5,0.5,0.5], 0.25), [0.425,0.5,0.575]));
// 纯白 t=1：红钳到 1，蓝降到 0.85
ok('t=1 白 [1,1,1] => [1,1,0.85]', eq3(applyBalance([1,1,1], 1), [1,1,0.85]));
// 纯黑 t=0：无效(同 GLSL if>0 不成立)
ok('t=0 黑不变', eq3(applyBalance([0,0,0], 0), [0,0,0]));
// 暖化单调性：t>0.5 时 r>g 且 b<g（以中灰为基准）
ok('t=1 暖化(r>g, b<g)', (()=>{ const c=applyBalance([0.5,0.5,0.5],1); return c[0] > c[1] && c[2] < c[1]; })());
ok('t=0.25 冷化(r<g, b>g)', (()=>{ const c=applyBalance([0.5,0.5,0.5],0.25); return c[0] < c[1] && c[2] > c[1]; })());
// 钳制
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyBalance(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uBalance uniform', /uniform float uBalance;/.test(src));
ok('main.js 含 uBalance GLSL 分支', /if\(uBalance > 0\.0\)\{/.test(src));
ok('main.js 绑定 uBalance uniform', /gl\.uniform1f\(u\(showProg,'uBalance'\), balance\);/.test(src));
ok('presetToParams 含 balance', /balance: num\(p\.balance, 0\)/.test(src));
ok('index.html 含 balance 滑块', /id="balance"/.test(html));
ok('index.html 含 balanceVal 显示', /id="balanceVal"/.test(html));

console.log(`\n[Lumen balance] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
