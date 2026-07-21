// ci129 Lumen 对比度后处理 —— 忠实移植 SHOW_FRAG 的 contrast 逻辑 + 源码接线检查
// GLSL:
//   if(uContrast != 1.0){
//     c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
//   }
'use strict';
const fs = require('fs');
const path = require('path');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 忠实移植：围绕中灰 0.5 线性拉伸(uContrast=1 恒等；<1 减对比趋向灰；>1 增对比)
function applyContrast(c, s){
  if (s === 1.0) return c.slice();                 // 关闭：恒等
  return [
    clamp((c[0] - 0.5) * s + 0.5, 0, 1),
    clamp((c[1] - 0.5) * s + 0.5, 0, 1),
    clamp((c[2] - 0.5) * s + 0.5, 0, 1)
  ];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. uContrast=1 恒等
ok(JSON.stringify(applyContrast([0.2, 0.5, 0.9], 1.0)) === JSON.stringify([0.2, 0.5, 0.9]), 'contrast=1 identity');

// 2. uContrast=0 → 全部挤压到中灰 0.5
{
  const r = applyContrast([0.2, 0.5, 0.9], 0.0);
  ok(approx(r[0], 0.5) && approx(r[1], 0.5) && approx(r[2], 0.5), 'contrast=0 collapses to 0.5');
}

// 3. uContrast=2 增对比：亮通道被推离 0.5（更亮），暗通道更暗
{
  const r = applyContrast([0.2, 0.5, 0.9], 2.0);
  ok(r[2] > 0.9 - 1e-9 && r[0] < 0.2 + 1e-9, 'contrast=2 increases contrast (blue up, red down)');
}

// 4. uContrast=0.5 减对比：各通道向 0.5 收敛(离 0.5 的最大偏差变小)
{
  const c = [0.1, 0.4, 0.9];
  const r = applyContrast(c, 0.5);
  const origDev = Math.max(Math.abs(c[0]-0.5), Math.abs(c[2]-0.5));
  const newDev = Math.max(Math.abs(r[0]-0.5), Math.abs(r[2]-0.5));
  ok(newDev < origDev, 'contrast=0.5 reduces spread from 0.5');
}

// 5. 结果始终在 [0,1]
{
  let bounded = true;
  for (const s of [0, 0.5, 1, 2, 3]) for (const c of [[0,0,0],[1,1,1],[0.1,0.9,0.5],[0.8,0.1,0.3]]){
    const r = applyContrast(c, s);
    if (r.some(v => v < -1e-9 || v > 1 + 1e-9)) bounded = false;
  }
  ok(bounded, 'output clamped to [0,1] for extreme contrast');
}

// 6. 单调性：contrast 越大，与中灰 0.5 的偏差越大
{
  const c = [0.2, 0.5, 0.9];
  const lo = applyContrast(c, 0.5), hi = applyContrast(c, 2.0);
  ok(Math.abs(hi[2] - 0.5) > Math.abs(lo[2] - 0.5), 'monotonic in contrast');
}

// 7. 确定性
ok(JSON.stringify(applyContrast([0.3,0.6,0.1], 1.7)) === JSON.stringify(applyContrast([0.3,0.6,0.1], 1.7)), 'deterministic');

// 8. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uContrast;/.test(main), 'SHOW_FRAG declares uniform float uContrast');
ok(/if\(uContrast != 1\.0\)\{/.test(main), 'SHOW_FRAG contrast guard');
ok(/clamp\(\(c - 0\.5\) \* uContrast \+ 0\.5, 0\.0, 1\.0\)/.test(main), 'SHOW_FRAG contrast math clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0)');
ok(/contrast: s\.contrast/.test(main), 'serializeScene includes contrast: s.contrast');
ok(/contrast: num\('contrast', 1\)/.test(main), 'deserializeScene includes contrast: num(\'contrast\', 1)');
ok(/contrast: num\(p\.contrast, 1\)/.test(main), 'presetToParams includes contrast: num(p.contrast, 1)');
ok(/contrast=s\.contrast;/.test(main), 'applyPreset/importScene assign contrast=s.contrast;');
ok(/gl\.uniform1f\(u\(showProg,'uContrast'\), contrast\);/.test(main), 'uniform bind gl.uniform1f(u(showProg,\'uContrast\'), contrast)');
ok(/grainStr, gamma, clampRad, satStr, contrast/.test(main), 'exportScene serializes contrast');
ok(/\$\('contrast'\)\.oninput/.test(main), 'UI oninput binds contrast');
ok(/\$\('contrast'\)\.value = Math\.round\(contrast \* 100\)/.test(main), 'syncSceneUI syncs contrast');
ok(/id="contrast"/.test(html), 'index.html has contrast slider');

console.log('raytracer/_contrast_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
