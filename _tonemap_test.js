// Lumen 色调映射单元测试：在 Node 中复刻 GLSL 数学，断言四种曲线的不变量，
// 并校验 main.js / index.html 已正确接线（防止回归）。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const approx = (a, b, t=1e-6)=> Math.abs(a-b) <= t;

// ---- Node 复刻（与 GLSL 一一对应）----
const aces = x => { const a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return Math.min(Math.max((x*(a*x+b))/(x*(c*x+d)+e),0),1); };
const reinhard = x => x/(1+x);
const linear = x => Math.min(Math.max(x,0),1);
const uncharted2 = x => { const A=0.15,B=0.50,C=0.10,D=0.20,E=0.02,F=0.30;
  const v = ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F)) - E/F; return Math.min(Math.max(v,0),1); };

const curves = { aces, reinhard, linear, uncharted2 };
const samples = [0, 0.25, 0.5, 1, 2, 4, 8, 16];

for(const [name, f] of Object.entries(curves)){
  // 1) f(0) ≈ 0
  ok(name+'(0)=0', approx(f(0), 0, 1e-9));
  // 2) 单调递增（x>=0）
  let mono = true;
  for(let i=1;i<samples.length;i++) if(f(samples[i]) < f(samples[i-1]) - 1e-9) mono = false;
  ok(name+' 单调递增', mono);
  // 3) 有界于 [0,1]
  let bounded = true;
  for(const x of samples) if(f(x) < -1e-9 || f(x) > 1+1e-9) bounded = false;
  ok(name+' ∈ [0,1]', bounded);
}

// 4) 各曲线互不相同（电影级曲线应有可见差异）
ok('uncharted2 != reinhard @1', !approx(uncharted2(1), reinhard(1), 1e-3));
ok('aces 中等亮度已压缩 @1 < 1', aces(1) < 0.999);
ok('reinhard 收敛 -> 1', approx(reinhard(1e6), 1, 1e-3));
ok('uncharted2 渐近 < 1', uncharted2(1e6) < 0.999);  // 渐近线约 0.933
ok('linear 裁剪 @16 = 1', linear(16) === 1);

// 5) 接线校验：main.js 必须定义 uncharted2 且 tonemap 走 m==3 分支
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
ok('main.js 含 uncharted2 函数', /vec3\s+uncharted2\s*\(/.test(main));
ok('main.js tonemap m==3 分支', /if\s*\(m\s*==\s*3\)\s*return\s+clamp\(uncharted2/.test(main));
// 6) index.html 下拉含 value="3"
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('index.html tone 选项 value=3', /id="tone"[\s\S]*?<option value="3"/.test(html));

console.log(`[Lumen tonemap] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
