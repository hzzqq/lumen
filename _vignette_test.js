// Lumen Vignette 暗角后处理参考测试（ci77）
// WebGL 着色器无法在 Node 直接跑，这里忠实移植 SHOW_FRAG 中 vignette() 的
// GLSL 数学到纯 JS，断言暗角的关键不变量：
//   1. 中心(uv=0.5,0.5) → 系数恒为 1（不压暗）
//   2. 边角(uv=0,0) → 系数 = 1 - str（最强压暗，随强度增大变暗）
//   3. 边缘中点(uv=0,0.5) → 系数 = 1 - str*0.5
//   4. 强度越大 → 同一离中心点的系数越小（单调压暗）
//   5. 系数恒落于 [0,1]（clamp 不变量）
//   6. 强度=0 → 任意位置系数恒为 1（关闭暗角）
//   7. 离中心越远 → 系数越小（径向单调）
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// --- 忠实移植：SHOW_FRAG vignette(vec2 uv, float str) ---
function vignette(uv, str){
  const dx = (uv[0] - 0.5) * 2.0;   // 映射到 [-1,1]
  const dy = (uv[1] - 0.5) * 2.0;
  const r2 = dx * dx + dy * dy;     // 0 中心 → 2 边角
  return Math.min(Math.max(1.0 - str * (r2 * 0.5), 0.0), 1.0);
}

// 1. 中心恒为 1
ok('center === 1', approx(vignette([0.5, 0.5], 0.5), 1.0));
ok('center === 1 @str=1', approx(vignette([0.5, 0.5], 1.0), 1.0));

// 2. 边角 = 1 - str，且随强度变暗
ok('corner str=0.5 === 0.5', approx(vignette([0, 0], 0.5), 0.5));
ok('corner str=1.0 === 0.0', approx(vignette([0, 0], 1.0), 0.0));
ok('corner str=0.2 === 0.8', approx(vignette([0, 0], 0.2), 0.8));

// 3. 边缘中点 = 1 - str*0.5
ok('edge mid str=1 === 0.5', approx(vignette([0, 0.5], 1.0), 0.5));
ok('edge mid str=0.6 === 0.7', approx(vignette([0, 0.5], 0.6), 0.7));

// 4. 强度越大，同点越暗（单调）
ok('monotonic in str @corner', vignette([0, 0], 0.9) < vignette([0, 0], 0.3));
ok('monotonic in str @edge', vignette([0, 0.5], 0.9) < vignette([0, 0.5], 0.3));

// 5. 系数恒落于 [0,1]
let bounded = true;
for(const str of [0, 0.1, 0.5, 1.0, 2.0]){
  for(let x = 0; x <= 4; x++) for(let y = 0; y <= 4; y++){
    const v = vignette([x / 4, y / 4], str);
    if(v < 0 || v > 1) bounded = false;
  }
}
ok('factor within [0,1] for all sampled uv/str', bounded);

// 6. 强度=0 恒为 1
let allOne = true;
for(let x = 0; x <= 4; x++) for(let y = 0; y <= 4; y++){
  if(!approx(vignette([x / 4, y / 4], 0), 1.0)) allOne = false;
}
ok('str=0 → everywhere 1', allOne);

// 7. 径向单调：越远越暗（同一 str）
const str = 0.8;
const center = vignette([0.5, 0.5], str);
const near   = vignette([0.4, 0.5], str);
const far    = vignette([0.0, 0.5], str);
ok('radial: center >= near >= far', center >= near && near >= far && far < center);

console.log(`\n_vignette_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
