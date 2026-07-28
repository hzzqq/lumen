// _ci428_lens_test.js — 验证 ci428：LensDistortion 镜头畸变(桶形/枕形)后处理
// 忠实移植 SHOW_FRAG 中 lensDistort 的 GLSL 数学到纯 JS，断言不变量；
// 并校验 main.js 已接线(uLens/uLensAmt uniform + apply 分支)，保证不是“假实现”。
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// --- 忠实移植：SHOW_FRAG lensDistort(vec2 uv, float amt, float str) ---
function lensDistort(uv, amt, str){
  const cx = uv[0] * 2.0 - 1.0;     // 居中到 [-1,1]
  const cy = uv[1] * 2.0 - 1.0;
  const r2 = cx * cx + cy * cy;      // 到中心距离平方
  const k = amt * str * 0.8;         // 符号由 amt 决定(正=桶形, 负=枕形), 强度由 str 驱动
  const dx = cx * (1.0 + k * r2);
  const dy = cy * (1.0 + k * r2);
  return [ Math.min(Math.max(dx * 0.5 + 0.5, 0.0), 1.0),
           Math.min(Math.max(dy * 0.5 + 0.5, 0.0), 1.0) ];
}

// 1. 画面中心恒为恒等(畸变在中心为 0)
for(const a of [1, 0.5, -1, -0.3, 0]) for(const s of [0, 0.3, 1]){
  const o = lensDistort([0.5, 0.5], a, s);
  ok('center identity a=' + a + ' s=' + s, approx(o[0], 0.5) && approx(o[1], 0.5));
}

// 2. 强度=0 恒为恒等(任意位置)
ok('str=0 角点恒等', approx(lensDistort([0, 0], 1, 0)[0], 0) && approx(lensDistort([1, 1], 1, 0)[1], 1));
ok('str=0 中心恒等', approx(lensDistort([0.5, 0.5], -1, 0)[0], 0.5));

// 3. 桶形(amt>0)把角点推向边缘(采样 uv 趋近 0)，枕形(amt<0)把角点拉向中心(uv>0)
ok('barrel 角点 uv2.x->0', lensDistort([0, 0], 1, 1)[0] === 0);
ok('barrel 角点 uv2.x<0.5', lensDistort([0, 0], 0.3, 0.5)[0] < 0.5);
ok('pincushion 角点 uv2.x>0.5', lensDistort([0, 0], -1, 1)[0] > 0.5);
ok('pincushion 角点 uv2.x>0(内缩)', lensDistort([0, 0], -0.3, 0.5)[0] > 0);

// 4. 符号反转：同 str，桶形角点落在枕形角点“更靠边”一侧
ok('sign flips displacement', lensDistort([0, 0], 1, 1)[0] < 0.5 && 0.5 < lensDistort([0, 0], -1, 1)[0]);

// 5. 强度单调：桶形 str 越大越靠边；枕形 str 越大越靠中心(取中缘点, 避免角点 clamp 到 0 掩盖单调性)
ok('barrel monotonic in str', lensDistort([0.25, 0.25], 1, 1)[0] < lensDistort([0.25, 0.25], 1, 0.5)[0]);
ok('pincushion monotonic in str', lensDistort([0.25, 0.25], -1, 1)[0] > lensDistort([0.25, 0.25], -1, 0.5)[0]);

// 6. 畸变后 uv 恒落于 [0,1]（clamp 不变量）
let bounded = true;
for(const s of [0, 0.2, 0.6, 1.0]) for(const a of [-1, -0.3, 0.3, 1]){
  for(let x = 0; x <= 4; x++) for(let y = 0; y <= 4; y++){
    const v = lensDistort([x / 4, y / 4], a, s);
    if(v[0] < 0 || v[0] > 1 || v[1] < 0 || v[1] > 1) bounded = false;
  }
}
ok('uv within [0,1] for all sampled', bounded);

// 7. 接线校验：main.js 实际包含该后处理的 uniform 与 apply 分支(防止“仅测试数学、未接线”)
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'main.js'), 'utf8');
ok('main.js 声明 uniform uLens', /uniform float uLens;/.test(src));
ok('main.js 声明 uniform uLensAmt', /uniform float uLensAmt;/.test(src));
ok('main.js 含 LensDistortion apply 分支', /if\(uLens > 0\.0\)\{[\s\S]*?LensDistortion/.test(src));
ok('main.js 绑定 uLens uniform', /gl\.uniform1f\(u\(showProg,'uLens'\), lens\);/.test(src));

console.log(`\n_ci428_lens_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
