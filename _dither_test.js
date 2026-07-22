// ci137 Lumen 有序抖动后处理 —— 忠实移植 4x4 Bayer 抖动逻辑 + 源码接线检查
// GLSL:
//   ix = gl_FragCoord.x & 3; iy = gl_FragCoord.y & 3;
//   t = bayer[iy*4+ix]/16 - 0.5;   c = clamp(c + uDither * t / 255, 0, 1)
'use strict';
const fs = require('fs');
const path = require('path');

// 4x4 Bayer 矩阵（与 GLSL 一致）
const BAYER = [
  0, 8, 2,10,
  12,4,14, 6,
  3,11, 1, 9,
  15,7,13, 5
];
// 忠实移植：按像素 (x,y) 取 Bayer 阈值，向每个通道注入 ±半阶量化噪声
function applyDither(c, x, y, amount){
  if (amount <= 0) return c.slice();                       // 关闭：恒等
  const ix = ((x % 4) + 4) % 4, iy = ((y % 4) + 4) % 4;     // 同 GLSL 的 & 3（非负像素）
  const t = (BAYER[iy*4 + ix] / 16.0) - 0.5;                // ∈ [-0.5, 0.5)
  return [
    Math.max(Math.min(c[0] + amount * t / 255.0, 1), 0),
    Math.max(Math.min(c[1] + amount * t / 255.0, 1), 0),
    Math.max(Math.min(c[2] + amount * t / 255.0, 1), 0),
  ];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. uDither=0 恒等
ok(JSON.stringify(applyDither([0.5,0.5,0.5], 3, 7, 0.0)) === JSON.stringify([0.5,0.5,0.5]), 'dither=0 identity');

// 2. 阈值范围 ∈ [-0.5, 0.5)
{
  let minT = 1, maxT = -1;
  for(let y=0;y<4;y++) for(let x=0;x<4;x++){ const t=(BAYER[y*4+x]/16)-0.5; minT=Math.min(minT,t); maxT=Math.max(maxT,t); }
  ok(approx(minT, -0.5) && maxT < 0.5 && maxT > -0.5, 'bayer threshold ∈ [-0.5, 0.5)');
}

// 3. 注入量有界：amount=1 时单通道扰动 ≤ 0.5/255 ≈ 0.00196，结果仍在 [0,1]
{
  let inRange = true;
  for(let y=0;y<4;y++) for(let x=0;x<4;x++) for(const base of [0,0.5,1]){
    const r = applyDither([base,base,base], x, y, 1.0);
    if(r.some(v=> v < -1e-9 || v > 1 + 1e-9)) inRange = false;
  }
  ok(inRange, 'dither output clamped to [0,1] for amount=1');
}

// 4. 同像素同输入确定性，且不同 Bayer 位置产生不同偏移
{
  const a = applyDither([0.7,0.7,0.7], 0, 0, 1.0);
  const b = applyDither([0.7,0.7,0.7], 0, 0, 1.0);
  ok(JSON.stringify(a) === JSON.stringify(b), 'deterministic per pixel');
  const c0 = applyDither([0.7,0.7,0.7], 0, 0, 1.0);
  const c1 = applyDither([0.7,0.7,0.7], 1, 0, 1.0);
  ok(JSON.stringify(c0) !== JSON.stringify(c1), 'different bayer cell => different offset');
}

// 5. amount 越大，与原始偏差（均值）越大（去条带强度递增）
{
  const base = [0.5,0.5,0.5];
  const d1 = applyDither(base, 0, 0, 0.5), d2 = applyDither(base, 0, 0, 1.0);
  const dev1 = Math.abs(d1[0]-0.5), dev2 = Math.abs(d2[0]-0.5);
  ok(dev2 > dev1, 'more amount => larger deviation from base');
}

// 6. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uDither;/.test(main), 'SHOW_FRAG declares uniform float uDither');
ok(/if\(uDither > 0\.0\)\{/.test(main), 'SHOW_FRAG dither guard');
ok(/bayer\[iy\*4 \+ ix\]/.test(main), 'SHOW_FRAG indexes bayer[iy*4+ix]');
ok(/c \+ uDither \* t \/ 255\.0/.test(main), 'SHOW_FRAG dither math c + uDither*t/255');
ok(/dither: s\.dither/.test(main), 'serializeScene includes dither: s.dither');
ok(/dither: num\('dither', 0\)/.test(main), 'deserializeScene includes dither: num(\'dither\', 0)');
ok(/dither: num\(p\.dither, 0\)/.test(main), 'presetToParams includes dither: num(p.dither, 0)');
ok(/dither=s\.dither;/.test(main), 'applyPreset/importScene assign dither=s.dither;');
ok(/gl\.uniform1f\(u\(showProg,'uDither'\), dither\);/.test(main), 'uniform bind gl.uniform1f(u(showProg,\'uDither\'), dither)');
ok(/contrast, sharpen, dither(, temp)?(, hue)?(, sepia)?(, posterize)?(, letterbox)?(, scanline)?/.test(main), 'exportScene serializes dither (+temp +hue +sepia +posterize +letterbox +scanline)');
ok(/\$\('dither'\)\.oninput/.test(main), 'UI oninput binds dither');
ok(/\$\('dither'\)\.value = Math\.round\(dither \* 100\)/.test(main), 'syncSceneUI syncs dither');
ok(/id="dither"/.test(html), 'index.html has dither slider');

console.log('raytracer/_dither_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
