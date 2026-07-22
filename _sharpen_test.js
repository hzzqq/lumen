// ci133 Lumen 锐化后处理 —— 忠实移植 SHOW_FRAG 的 sharpen(非锐化掩膜) 逻辑 + 源码接线检查
// GLSL:
//   vec3 blur = (sampleHDR(up)+sampleHDR(down)+sampleHDR(left)+sampleHDR(right)) * 0.25;
//   cHDR = max(cHDR + uSharpen * (cHDR - blur), 0.0);
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植：4 邻域均值作为模糊估计，中心减去模糊再按 amount 叠加回中心(uSharpen=0 恒等)
function boxBlur4(up, down, left, right){
  return [
    (up[0]+down[0]+left[0]+right[0]) / 4,
    (up[1]+down[1]+left[1]+right[1]) / 4,
    (up[2]+down[2]+left[2]+right[2]) / 4,
  ];
}
function applySharpen(c, blur, amount){
  if (amount <= 0) return c.slice();                       // 关闭：恒等
  return [
    Math.max(c[0] + amount * (c[0] - blur[0]), 0),
    Math.max(c[1] + amount * (c[1] - blur[1]), 0),
    Math.max(c[2] + amount * (c[2] - blur[2]), 0),
  ];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. uSharpen=0 恒等
ok(JSON.stringify(applySharpen([0.2,0.5,0.9], [0.4,0.4,0.4], 0.0)) === JSON.stringify([0.2,0.5,0.9]), 'sharpen=0 identity');

// 2. 中心比邻域亮 → 锐化后更亮
{
  const c = [0.9, 0.9, 0.9], blur = boxBlur4([0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5]);
  const r = applySharpen(c, blur, 1.0);
  ok(r[0] > 0.9 - 1e-9, 'sharpen brightens a bright center vs dim neighbors');
}

// 3. 中心比邻域暗 → 锐化后更暗(被钳到 0)
{
  const c = [0.1, 0.1, 0.1], blur = boxBlur4([0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,0.5]);
  const r = applySharpen(c, blur, 1.0);
  ok(r[0] < 0.1 + 1e-9 && r[0] >= -1e-9, 'sharpen darkens a dark center vs bright neighbors');
}

// 4. 结果恒 >= 0（max 钳制）
{
  let bounded = true;
  for (const a of [0.5, 1, 2, 3]) for (const c of [[0,0,0],[1,1,1],[0.2,0.8,0.5]]){
    const blur = [0.9,0.9,0.9];
    const r = applySharpen(c, blur, a);
    if (r.some(v => v < -1e-9)) bounded = false;
  }
  ok(bounded, 'sharpen output never negative (max clamp)');
}

// 5. 单调性：amount 越大，与模糊估计的偏差越大
{
  const c = [0.9, 0.9, 0.9], blur = boxBlur4([0.3,0.3,0.3],[0.3,0.3,0.3],[0.3,0.3,0.3],[0.3,0.3,0.3]);
  const lo = applySharpen(c, blur, 0.5), hi = applySharpen(c, blur, 2.0);
  ok(Math.abs(hi[0]-blur[0]) > Math.abs(lo[0]-blur[0]), 'monotonic in sharpen amount');
}

// 6. 逐通道独立
{
  const c = [0.9, 0.5, 0.1], blur = [0.5, 0.5, 0.5];
  const r = applySharpen(c, blur, 1.0);
  ok(approx(r[0], 1.3) && approx(r[1], 0.5) && approx(r[2], 0.0), 'per-channel independent (R up, G same, B clamped)');
}

// 7. 确定性
ok(JSON.stringify(applySharpen([0.3,0.6,0.1],[0.2,0.2,0.2],1.7)) === JSON.stringify(applySharpen([0.3,0.6,0.1],[0.2,0.2,0.2],1.7)), 'deterministic');

// 8. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uSharpen;/.test(main), 'SHOW_FRAG declares uniform float uSharpen');
ok(/if\(uSharpen > 0\.0\)\{/.test(main), 'SHOW_FRAG sharpen guard');
ok(/cHDR \+ uSharpen \* \(cHDR - blur\)/.test(main), 'SHOW_FRAG sharpen math cHDR + uSharpen * (cHDR - blur)');
ok(/sharpen: s\.sharpen/.test(main), 'serializeScene includes sharpen: s.sharpen');
ok(/sharpen: num\('sharpen', 0\)/.test(main), 'deserializeScene includes sharpen: num(\'sharpen\', 0)');
ok(/sharpen: num\(p\.sharpen, 0\)/.test(main), 'presetToParams includes sharpen: num(p.sharpen, 0)');
ok(/sharpen=s\.sharpen;/.test(main), 'applyPreset/importScene assign sharpen=s.sharpen;');
ok(/gl\.uniform1f\(u\(showProg,'uSharpen'\), sharpen\);/.test(main), 'uniform bind gl.uniform1f(u(showProg,\'uSharpen\'), sharpen)');
ok(/contrast, sharpen, dither(, temp)?(, hue)?(, sepia)?(, posterize)?(, letterbox)?(, scanline)? \}\);/.test(main), 'exportScene serializes sharpen + dither (+temp +hue +sepia +posterize +letterbox +scanline)');
ok(/\$\('sharpen'\)\.oninput/.test(main), 'UI oninput binds sharpen');
ok(/\$\('sharpen'\)\.value = Math\.round\(sharpen \* 100\)/.test(main), 'syncSceneUI syncs sharpen');
ok(/id="sharpen"/.test(html), 'index.html has sharpen slider');

console.log('raytracer/_sharpen_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
