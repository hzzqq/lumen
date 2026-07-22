// ci157 Lumen 电影黑边(Letterbox) —— 忠实移植 uLetterbox 的上下黑边判定(基于 vUv.y) + 源码接线检查
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植 main.js 的黑边判定：frac 为每条黑边占画面高度比例(0=关闭)，y∈[0,frac)∪(1-frac,1] 为黑边区
function inLetterbox(y, frac){
  if(!(frac > 0)) return false;
  const hb = Math.min(Math.max(frac, 0), 0.5);
  return (y < hb) || (y > 1.0 - hb);
}
// 黑边区内的颜色(纯黑)
function applyLetterbox(c, y, frac){ return inLetterbox(y, frac) ? { r:0, g:0, b:0 } : c; }

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

// 1. 关闭时(frac=0)无任何黑边
ok('frac=0 全画面无黑边', !inLetterbox(0.0, 0) && !inLetterbox(0.5, 0) && !inLetterbox(0.99, 0));
ok('frac 负数视为关闭', !inLetterbox(0.01, -0.1));

// 2. frac=0.1：上下各 10% 黑边
ok('frac=0.1 顶部 y=0.05 在黑边', inLetterbox(0.05, 0.1));
ok('frac=0.1 底部 y=0.95 在黑边', inLetterbox(0.95, 0.1));
ok('frac=0.1 中部 y=0.5 不在黑边', !inLetterbox(0.5, 0.1));
ok('frac=0.1 边界 y=0.1 恰在黑边外(严格下界)', !inLetterbox(0.1, 0.1));
ok('frac=0.1 边界 y=0.9 恰在黑边外(严格上界)', !inLetterbox(0.9, 0.1));

// 3. frac=0.25：宽幅电影黑边
ok('frac=0.25 顶部 y=0.2 在黑边', inLetterbox(0.2, 0.25));
ok('frac=0.25 中部 y=0.5 不在黑边', !inLetterbox(0.5, 0.25));

// 4. frac 上限钳制 0.5：y=0.49 在黑边(0.49 < 0.5)
ok('frac=0.5 钳制后 y=0.49 在黑边', inLetterbox(0.49, 0.5));

// 5. 应用：黑边区返回纯黑
{
  const c = { r:0.4, g:0.2, b:0.7 };
  const inBar = applyLetterbox(c, 0.02, 0.1);
  const mid = applyLetterbox(c, 0.5, 0.1);
  ok('黑边区颜色置 0', inBar.r===0 && inBar.g===0 && inBar.b===0);
  ok('非黑边区保持原色', mid.r===0.4 && mid.g===0.2 && mid.b===0.7);
}

// 6. 接线检查
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uLetterbox;/.test(main), 'main.js 声明 uLetterbox uniform');
ok(/uLetterbox > 0\.0/.test(main) && /vUv\.y < hb \|\| vUv\.y > 1\.0 - hb/.test(main), 'SHOW_FRAG 实施上下黑边判定(vUv.y)');
ok(/, posterize=0, letterbox=0(, scanline=0)?[,;]/.test(main), 'state 默认 letterbox=0');
ok(/, letterbox: s\.letterbox/.test(main), 'serializeScene 含 letterbox');
ok(/letterbox: num\('letterbox', 0\)/.test(main), 'deserializeScene 读 letterbox');
ok(/posterize: num\(p\.posterize, 0\), letterbox: num\(p\.letterbox, 0\)/.test(main), 'presetToParams 读 letterbox');
ok(/posterize=s\.posterize; letterbox=s\.letterbox;/.test(main), 'applyPreset/load 设 letterbox');
ok(/if\(\$\('letterbox'\)\) \$\('letterbox'\)\.value = Math\.round\(letterbox \* 100\);/.test(main), 'syncSceneUI 设 letterbox 滑块');
ok(/dither, temp, hue, sepia, posterize, letterbox \}\);/.test(main), 'exportScene 含 letterbox');
ok(/gl\.uniform1f\(u\(showProg,'uLetterbox'\), letterbox\);/.test(main), 'uniform 绑定 uLetterbox');
ok(/\$\('letterbox'\)\.oninput/.test(main), 'main.js 绑定 letterbox 滑块');
ok(/id="letterbox"/.test(html) && /id="letterboxVal"/.test(html), 'index.html 含 letterbox 滑块');

console.log('raytracer/_letterbox_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
