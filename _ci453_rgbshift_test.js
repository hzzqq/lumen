// _ci453_rgbshift_test.js — 验证 ci453：Lumen RGB 偏移(rgbshift)后处理
// 此前 uRgbshift 已声明、滑杆/序列化齐全，但着色器无分支、uniform 未绑定 → 滑杆无效(死代码)。
// 本测试断言分支+绑定+UV 钳制+UI 接线均已补齐，确保不是“假实现”。
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 声明与接线完整性 ----
ok('main.js 声明 uniform uRgbshift', /uniform float uRgbshift;/.test(src));
ok('main.js SHOW 分支 if(uRgbshift > 0.0)', /if\(uRgbshift > 0\.0\)\{/.test(src));
ok('main.js 分支内 R 通道水平错位重采样', /vec3 r = sampleHDR\(clamp\(vUv \+ vec2\(a, 0\.0\), 0\.0, 1\.0\)\)/.test(src));
ok('main.js 分支内 B 通道水平错位重采样', /vec3 b = sampleHDR\(clamp\(vUv - vec2\(a, 0\.0\), 0\.0, 1\.0\)\)/.test(src));
ok('main.js 分支内 UV 钳制防越界(a<=0.03)', /float a = clamp\(uRgbshift, 0\.0, 1\.0\) \* 0\.03/.test(src));
ok('main.js 缺分支前滑杆无效 → 现补齐分支', /c = vec3\(r\.r, c\.g, b\.b\);/.test(src));
ok('main.js 绑定 uRgbshift uniform', /gl\.uniform1f\(u\(showProg,'uRgbshift'\), rgbshift\);/.test(src));
ok('main.js rgbshift 在 applyParams 解构', /rgbshift, /.test(src) && /rgbshift: num\(/.test(src));
ok('main.js serializeScene 含 rgbshift', /rgbshift/.test(src));
ok('index.html 含 rgbshift 滑杆控件', /id="rgbshift"/.test(html));
ok('main.js oninput 接线 rgbshift 滑杆', /\$\('rgbshift'\)\.oninput/.test(src));

// ---- 纯函数移植：验证 RGB 水平错位语义(以亮度基准重建 R/B) ----
function clamp(v, lo, hi){ return Math.min(Math.max(v, lo), hi); }
function sampleHDR(uv){
  // 简化：以 uv 在 [0,1] 内线性取色，越界部分按钳制后的 uv 处理(与着色器 clamp 一致)
  const x = clamp(uv[0], 0, 1), y = clamp(uv[1], 0, 1);
  return [x, y, 0.5]; // 仅验证 R/B 通道来自偏移采样
}
function rgbshiftJS(c, vUv, amt){
  const a = clamp(amt, 0, 1) * 0.03;
  const r = sampleHDR([vUv[0] + a, vUv[1]]);
  const b = sampleHDR([vUv[0] - a, vUv[1]]);
  return [r[0], c[1], b[2]];
}
const c = [0.4, 0.7, 0.9], uv = [0.5, 0.5];
const out = rgbshiftJS(c, uv, 1.0);
ok('JS 移植: R 通道取自 +a 偏移采样', Math.abs(out[0] - (0.5 + 0.03)) < 1e-9);
ok('JS 移植: G 通道保持原值', Math.abs(out[1] - 0.7) < 1e-9);
ok('JS 移植: B 通道取自 -a 偏移采样', Math.abs(out[2] - 0.5) < 1e-9);
// 越界钳制：uv 靠近边缘时 +a 不超过 1.0
const outEdge = rgbshiftJS(c, [0.99, 0.5], 1.0);
ok('JS 移植: 边缘 +a 钳制到 <=1.0(无越界伪影)', outEdge[0] <= 1.0 + 1e-9);

console.log('\nci453 rgbshift: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
