// Lumen Gamma 显示校正参考测试（ci81）
// WebGL 着色器无法在 Node 直接跑，这里忠实移植 SHOW_FRAG 中 gamma 校正的
// GLSL 数学到纯 JS，断言关键不变量：
//   1. gamma=1 → 颜色不变（线性直通）
//   2. gamma=2.2 → 暗部提亮（mid 0.5 → 更亮）
//   3. gamma<1 → 压暗（mid 0.5 → 更暗）
//   4. gamma 越大越提亮：gammaCorrect(0.5, g) 随 g 增大而增大（单调）
//   5. 各通道独立应用（RGB 分别校正、互不影响）
//   6. 输出恒落于 [0,1]（clamp 不变量）
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// --- 忠实移植：SHOW_FRAG 的 c = pow(c, vec3(1.0 / uGamma)) ---
function gammaCorrect(c, gamma){
  const inv = 1.0 / gamma;
  return [ Math.pow(c[0], inv), Math.pow(c[1], inv), Math.pow(c[2], inv) ];
}

// 1. gamma=1 不变
ok('gamma=1 不变 (0.3)', approx(gammaCorrect([0.3,0.5,0.8], 1)[0], 0.3));
ok('gamma=1 不变 (整体)', JSON.stringify(gammaCorrect([0.2,0.4,0.6], 1)) === JSON.stringify([0.2,0.4,0.6]));

// 2. gamma=2.2 提亮暗部
{
  const mid = 0.5, g = gammaCorrect([mid,mid,mid], 2.2)[0];
  ok('gamma=2.2 提亮 mid>0.5', g > mid);
  ok('gamma=2.2 数值≈0.729', approx(g, Math.pow(0.5, 1/2.2), 1e-4));
}

// 3. gamma<1 压暗
{
  const mid = 0.5, g = gammaCorrect([mid,mid,mid], 0.5)[0];
  ok('gamma=0.5 压暗 mid<0.5', g < mid);
  ok('gamma=0.5 数值=0.25', approx(g, 0.25, 1e-6));
}

// 4. gamma 越大越提亮（单调）
{
  const vals = [1.0, 1.5, 2.2, 3.0].map(g => gammaCorrect([0.5,0.5,0.5], g)[0]);
  let mono = true; for(let i=1;i<vals.length;i++) if(vals[i] <= vals[i-1]) mono = false;
  ok('gamma 越大越提亮(单调)', mono);
}

// 5. 各通道独立
{
  const c = [0.2, 0.6, 0.9];
  const o = gammaCorrect(c, 2.2);
  ok('R 通道独立', approx(o[0], Math.pow(0.2, 1/2.2), 1e-6));
  ok('G 通道独立', approx(o[1], Math.pow(0.6, 1/2.2), 1e-6));
  ok('B 通道独立', approx(o[2], Math.pow(0.9, 1/2.2), 1e-6));
}

// 6. 输出恒落于 [0,1]
{
  let bounded = true;
  for(const g of [0.4, 1.0, 2.2, 3.0]){
    for(let x=0; x<=10; x++){ const c = x/10; const v = gammaCorrect([c,c,c], g)[0]; if(v < 0 || v > 1) bounded = false; }
  }
  ok('输出恒在 [0,1]', bounded);
}

console.log(`\n_gamma_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
