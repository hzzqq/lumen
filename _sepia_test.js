// ci149 Lumen 复古褐调后处理 —— 忠实移植 uSepia 的经典 sepia 矩阵混合 + 源码接线检查
// GLSL: sep = vec3(dot(c, vec3(0.393,0.769,0.189)), dot(c, vec3(0.349,0.686,0.168)), dot(c, vec3(0.272,0.534,0.131)));
//       c = clamp(mix(c, sep, uSepia), 0, 1);
'use strict';
const fs = require('fs');
const path = require('path');

function clamp1(v){ return Math.max(0, Math.min(1, v)); }
// 忠实移植：对 RGB 应用复古褐调(str∈[0,1]，0=恒等, 1=满褐)
function applySepia(c, str){
  str = (str == null) ? 0 : str;
  const sr = 0.393*c[0] + 0.769*c[1] + 0.189*c[2];
  const sg = 0.349*c[0] + 0.686*c[1] + 0.168*c[2];
  const sb = 0.272*c[0] + 0.534*c[1] + 0.131*c[2];
  return [
    clamp1(c[0]*(1-str) + sr*str),
    clamp1(c[1]*(1-str) + sg*str),
    clamp1(c[2]*(1-str) + sb*str)
  ];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
const near = (a, b, eps=1e-6)=> Math.abs(a-b) < eps;

// 1. 零强度恒等
{
  const c = [0.4, 0.2, 0.7];
  const r = applySepia(c, 0);
  ok('sepia=0 恒等', near(r[0],0.4) && near(r[1],0.2) && near(r[2],0.7));
}

// 2. 满强度灰阶输入 → 经典褐调
{
  const r = applySepia([0.5,0.5,0.5], 1);
  ok('sepia=1 灰(0.5) R=0.6755', near(r[0], 0.6755, 1e-4));
  ok('sepia=1 灰(0.5) G=0.6015', near(r[1], 0.6015, 1e-4));
  ok('sepia=1 灰(0.5) B=0.4685', near(r[2], 0.4685, 1e-4));
  ok('sepia=1 灰 B<G<R(暖褐)', r[2] < r[1] && r[1] < r[0]);
}

// 3. 半强度 = 恒等与满褐的中点
{
  const full = applySepia([0.5,0.5,0.5], 1);
  const half = applySepia([0.5,0.5,0.5], 0.5);
  ok('sepia=0.5 为 0 与 1 中点', near(half[0], (0.5+full[0])/2, 1e-6) && near(half[1], (0.5+full[1])/2, 1e-6) && near(half[2], (0.5+full[2])/2, 1e-6));
}

// 4. 钳制到 [0,1]
{
  const r = applySepia([1,1,1], 1);
  ok('sepia=1 白 R 钳制为 1', near(r[0], 1, 1e-6));
  ok('sepia=1 白 G 钳制为 1', near(r[1], 1, 1e-6));
  ok('sepia=1 白 B = 0.937', near(r[2], 0.937, 1e-6));
}

// 5. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uSepia;/.test(main), 'main.js declares uniform float uSepia');
ok(/uSepia > 0\.0/.test(main), 'SHOW_FRAG applies uSepia gate');
ok(/vec3\(0\.393, 0\.769, 0\.189\)/.test(main), 'sepia 矩阵 R 系数 0.393');
ok(/mix\(c, sep, uSepia\)/.test(main), 'SHOW_FRAG mixes c with sepia by uSepia');
ok(/, sepia: s\.sepia/.test(main), 'serializeScene includes sepia');
ok(/sepia: num\('sepia', 0\)/.test(main), 'deserializeScene reads sepia');
ok(/temp: num\('temp', 0\), hue: num\('hue', 0\), sepia: num\('sepia', 0\)/.test(main), 'presetToParams reads sepia');
ok(/temp=s\.temp; hue=s\.hue; sepia=s\.sepia;/.test(main), 'applyPreset + load set sepia');
ok(/if\(\$\('sepia'\)\) \$\('sepia'\)\.value = Math\.round\(sepia \* 100\);/.test(main), 'syncSceneUI sets sepia slider');
ok(/dither, temp, hue, sepia(, posterize)?(, letterbox)?(, scanline)? \}\);/.test(main), 'exportScene object includes sepia');
ok(/gl\.uniform1f\(u\(showProg,'uSepia'\), sepia\);/.test(main), 'uniform bind uSepia');
ok(/\$\('sepia'\)\.oninput/.test(main), 'main.js binds sepia slider');
ok(/id="sepia"/.test(html) && /id="sepiaVal"/.test(html), 'index.html has sepia slider');

console.log('raytracer/_sepia_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
