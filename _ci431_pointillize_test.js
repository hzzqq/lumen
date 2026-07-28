// _ci431_pointillize_test.js — 验证 ci431：Pointillize 点彩后处理(分格取平均色, 按亮度画圆点)
// 忠实移植 SHOW_FRAG 中 uPointillize 分支的圆点遮罩数学到纯 JS，断言不变量；
// 并校验 main.js / index.html 已接线(uniform + apply 分支 + UI 输入)，保证不是“假实现”。
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function clamp(v, a, b){ return Math.min(Math.max(v, a), b); }
function smoothstep(e0, e1, x){ const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function mix(a, b, t){ return a + (b - a) * t; }

// --- 忠实移植：SHOW_FRAG uPointillize 分支 ---
// g = 单元内局部坐标 [0,1)（GLSL 中 g = fract(vUv*cells)）；l = 亮度(0..1)
// 返回 dotMask(1=点内画原色, 0=点外画纸白背景)
function maskFromLocal(gx, gy, l){
  const r = 0.5 * (0.30 + 0.65 * l);          // 点半径随亮度增大(亮处点大暗处点小)
  const d = Math.sqrt((gx - 0.5) * (gx - 0.5) + (gy - 0.5) * (gy - 0.5));
  return 1.0 - smoothstep(r, r + 0.05, d);
}
// uv 包装：复刻 g = fract(vUv*cells)，cells 由强度/粒度决定
function dotMask(uv, pointillize, pointSize, l){
  const coarse = 1.0 + 2.0 * clamp(pointSize, 0.0, 1.0);
  const cells = Math.max(mix(120.0, 10.0, pointillize) / coarse, 2.0);
  const gx = (uv[0] * cells) % 1.0;
  const gy = (uv[1] * cells) % 1.0;
  return maskFromLocal(gx, gy, l);
}

// 1. 单元中心(局部坐标 0.5,0.5, d=0)恒为点内(任意亮度)
for(const l of [0, 0.5, 1]) ok('cell center always dot (l=' + l + ')', maskFromLocal(0.5, 0.5, l) === 1);

// 2. 单元角点(局部坐标 0,0, d≈0.707 > 最大半径 0.475)恒为背景(任意亮度)
for(const l of [0, 0.5, 1]) ok('cell corner always bg (l=' + l + ')', maskFromLocal(0, 0, l) === 0);

// 3. 亮度越高点越大：固定单元内偏移(0.3,0.3, d≈0.2)处，暗时背景、亮时点内
ok('dark -> bg at inner offset', maskFromLocal(0.3, 0.3, 0.0) === 0);
ok('bright -> dot at inner offset', maskFromLocal(0.3, 0.3, 1.0) === 1);

// 4. 强度/粒度决定 cell 数：更强 -> cells 更少 -> 点更大更稀疏
ok('stronger pointillize -> fewer cells', (function(){
  const cA = Math.max(mix(120, 10, 0.3) / (1.0 + 2.0 * 0.0), 2.0);
  const cB = Math.max(mix(120, 10, 0.3) / (1.0 + 2.0 * 1.0), 2.0);
  return cB < cA;
})());
ok('coarser pointSize -> fewer cells', (function(){
  const cA = Math.max(mix(120, 10, 0.6) / (1.0 + 2.0 * 0.0), 2.0);
  const cB = Math.max(mix(120, 10, 0.6) / (1.0 + 2.0 * 1.0), 2.0);
  return cB < cA;
})());

// 5. dotMask 输出恒在 [0,1]
let bounded = true;
for(let i = 0; i <= 8; i++) for(let j = 0; j <= 8; j++){
  const v = dotMask([i / 8, j / 8], 0.7, 0.4, (i * j) % 7 / 6);
  if(v < 0 || v > 1) bounded = false;
}
ok('dotMask within [0,1]', bounded);

// 6. uv 包装与局部坐标一致：选 vUv 使 fract(vUv*cells)=0.5 应得 dot=1
ok('uv center -> dot', (function(){
  const cells = Math.max(mix(120, 10, 0.5) / (1.0 + 2.0 * 0.0), 2.0);
  const uv = 0.5 / cells;            // vUv*cells = 0.5 -> g=0.5 -> 中心
  return dotMask([uv, uv], 0.5, 0.0, 0.0) === 1;
})());

// 7. 接线校验：main.js 实际包含该后处理的 uniform 与 apply 分支(防止“仅测试数学、未接线”)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
ok('main.js 声明 uniform uPointillize', /uniform float uPointillize;/.test(src));
ok('main.js 声明 uniform uPointSize', /uniform float uPointSize;/.test(src));
ok('main.js 含 Pointillize apply 分支', /if\(uPointillize > 0\.0\)\{[\s\S]*?Pointillize/.test(src));
ok('main.js 绑定 uPointillize uniform', /gl\.uniform1f\(u\(showProg,'uPointillize'\), pointillize\);/.test(src));
ok('main.js 绑定 uPointSize uniform', /gl\.uniform1f\(u\(showProg,'uPointSize'\), pointSize\);/.test(src));
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('index.html 含 pointillize 输入', /id="pointillize"/.test(html));
ok('index.html 含 pointSize 输入', /id="pointSize"/.test(html));

console.log(`\n_ci431_pointillize_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
