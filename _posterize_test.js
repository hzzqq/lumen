// ci153 Lumen 色调分层(Posterize) —— 忠实移植 uPosterize 的色阶量化 c = floor(c*L)/(L-1) + 源码接线检查
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植 main.js 的色调分层：levels<2 关闭(恒等)，否则每通道量化到 L 个离散色阶(结果钳制 [0,1])
function applyPosterize(c, levels){
  if(!(levels >= 2)) return c;
  const inv = 1 / (levels - 1);
  const q = v => Math.min(1, Math.max(0, Math.floor(v * levels) * inv));
  return { r: q(c.r), g: q(c.g), b: q(c.b) };
}
const near = (a, b, eps=1e-6)=> Math.abs(a - b) <= eps;

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

// 1. 关闭时恒等
{
  const c = { r:0.4, g:0.2, b:0.7 };
  const r0 = applyPosterize(c, 0), r1 = applyPosterize(c, 1);
  ok('levels=0 恒等', r0.r===0.4 && r0.g===0.2 && r0.b===0.7);
  ok('levels=1 恒等(阈值 >=2)', r1.r===0.4 && r1.g===0.2 && r1.b===0.7);
}

// 2. levels=2 → 二值(0 或 1)
{
  const lo = applyPosterize({ r:0.4, g:0.4, b:0.4 }, 2);
  const hi = applyPosterize({ r:0.6, g:0.6, b:0.6 }, 2);
  ok('levels=2 低值→0', lo.r===0 && lo.g===0 && lo.b===0);
  ok('levels=2 高值→1', hi.r===1 && hi.g===1 && hi.b===1);
}

// 3. levels=4 → 4 级色阶(0, .333, .667, 1)
{
  const r = applyPosterize({ r:0.5, g:0.9, b:0.0 }, 4);
  ok('levels=4 c=0.5 → 2/3≈0.6667', near(r.r, 2/3, 1e-6));
  ok('levels=4 c=0.9 → 3/3=1', near(r.g, 1, 1e-6));
  ok('levels=4 c=0.0 → 0', near(r.b, 0, 1e-6));
}

// 4. levels=8 → 8 级色阶
{
  const r = applyPosterize({ r:0.5, g:0.5, b:0.5 }, 8);
  ok('levels=8 c=0.5 → 4/7≈0.5714', near(r.r, 4/7, 1e-6));
}

// 5. 白色仍白(与 sepia 的色偏区分)
{
  const w = applyPosterize({ r:1, g:1, b:1 }, 4);
  ok('白(1,1,1) 分层后仍为白', w.r===1 && w.g===1 && w.b===1);
}

// 6. 单调非减：量化值随输入增大不降
{
  let prev = -1, mono = true;
  for(let v=0; v<=1.0001; v+=0.05){ const q = applyPosterize({ r:v, g:v, b:v }, 5).r; if(q < prev - 1e-9) mono = false; prev = q; }
  ok('量化值单调非减', mono);
}

// 7. 接线检查
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uPosterize;/.test(main), 'main.js 声明 uPosterize uniform');
ok(/uPosterize >= 2\.0/.test(main) && /floor\(c \* uPosterize\)/.test(main) && /clamp\(floor\(c \* uPosterize\)/.test(main), 'SHOW_FRAG 实施色阶量化(阈值>=2, 钳制[0,1])');
ok(/, sepia=0, posterize=0;/.test(main), 'state 默认 posterize=0');
ok(/, posterize: s\.posterize/.test(main), 'serializeScene 含 posterize');
ok(/posterize: num\('posterize', 0\)/.test(main), 'deserializeScene 读 posterize');
ok(/sepia: num\(p\.sepia, 0\), posterize: num\(p\.posterize, 0\)/.test(main), 'presetToParams 读 posterize');
ok(/sepia=s\.sepia; posterize=s\.posterize;/.test(main), 'applyPreset/load 设 posterize');
ok(/if\(\$\('posterize'\)\) \$\('posterize'\)\.value = posterize;/.test(main), 'syncSceneUI 设 posterize 滑块');
ok(/dither, temp, hue, sepia, posterize \}\);/.test(main), 'exportScene 含 posterize');
ok(/gl\.uniform1f\(u\(showProg,'uPosterize'\), posterize\);/.test(main), 'uniform 绑定 uPosterize');
ok(/\$\('posterize'\)\.oninput/.test(main), 'main.js 绑定 posterize 滑块');
ok(/id="posterize"/.test(html) && /id="posterizeVal"/.test(html), 'index.html 含 posterize 滑块');

console.log('raytracer/_posterize_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
