// ci125 Lumen 饱和度后处理 —— 忠实移植 SHOW_FRAG 的 saturation 逻辑 + 源码接线检查
// GLSL:
//   if(uSatStr != 1.0){
//     float l = dot(c, vec3(0.299, 0.587, 0.114));
//     c = clamp(mix(vec3(l), c, uSatStr), 0.0, 1.0);
//   }
'use strict';
const fs = require('fs');
const path = require('path');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 忠实移植：对灰度 l 做线性插值(uSatStr=1 恒等；<1 去饱和趋向灰；>1 增饱和)
function applySaturation(c, s){
  if (s === 1.0) return c.slice();                 // 关闭：恒等
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return [clamp(l + (c[0] - l) * s, 0, 1), clamp(l + (c[1] - l) * s, 0, 1), clamp(l + (c[2] - l) * s, 0, 1)];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. uSatStr=1 恒等
ok(JSON.stringify(applySaturation([0.2, 0.5, 0.9], 1.0)) === JSON.stringify([0.2, 0.5, 0.9]), 'satStr=1 identity');

// 2. uSatStr=0 → 全灰(三通道都等于 l)
{
  const r = applySaturation([0.2, 0.5, 0.9], 0.0);
  const l = 0.2 * 0.299 + 0.5 * 0.587 + 0.9 * 0.114;
  ok(approx(r[0], l) && approx(r[1], l) && approx(r[2], l), 'satStr=0 grayscale');
}

// 3. uSatStr=2 增饱和：红通道被推离灰度
{
  const r = applySaturation([0.2, 0.5, 0.9], 2.0);
  ok(r[2] > 0.9 - 1e-9 && r[0] < 0.2 + 1e-9, 'satStr=2 increases saturation (blue up, red down)');
}

// 4. uSatStr=0.5 减饱和：三通道向灰度收敛(方差变小)
{
  const c = [0.1, 0.4, 0.9];
  const r = applySaturation(c, 0.5);
  const origVar = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  const newVar = Math.max(r[0], r[1], r[2]) - Math.min(r[0], r[1], r[2]);
  ok(newVar < origVar, 'satStr=0.5 reduces saturation spread');
}

// 5. 结果始终在 [0,1]
{
  let bounded = true;
  for (const s of [0, 0.5, 1, 2, 3]) for (const c of [[0,0,0],[1,1,1],[0.1,0.9,0.5],[0.8,0.1,0.3]]){
    const r = applySaturation(c, s);
    if (r.some(v => v < -1e-9 || v > 1 + 1e-9)) bounded = false;
  }
  ok(bounded, 'output clamped to [0,1] for extreme satStr');
}

// 6. 单调性：satStr 越大，红色与灰度差绝对值越大
{
  const c = [0.2, 0.5, 0.9];
  const lo = applySaturation(c, 0.5), hi = applySaturation(c, 2.0);
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  ok(Math.abs(hi[0] - l) > Math.abs(lo[0] - l), 'monotonic in satStr');
}

// 7. 确定性
ok(JSON.stringify(applySaturation([0.3,0.6,0.1], 1.7)) === JSON.stringify(applySaturation([0.3,0.6,0.1], 1.7)), 'deterministic');

// 8. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uSatStr;/.test(main), 'SHOW_FRAG declares uniform float uSatStr');
ok(/if\(uSatStr != 1\.0\)\{/.test(main), 'SHOW_FRAG saturation guard');
ok(/clamp\(mix\(vec3\(l\), c, uSatStr\), 0\.0, 1\.0\)/.test(main), 'SHOW_FRAG saturation math clamp(mix(vec3(l), c, uSatStr), 0.0, 1.0)');
ok(/satStr: s\.satStr/.test(main), 'serializeScene includes satStr: s.satStr');
ok(/satStr: num\('satStr', 1\)/.test(main), 'deserializeScene includes satStr: num(\'satStr\', 1)');
ok(/satStr: num\(p\.satStr, 1\)/.test(main), 'presetToParams includes satStr: num(p.satStr, 1)');
ok(/satStr=s\.satStr;/.test(main), 'applyPreset/importScene assign satStr=s.satStr;');
ok(/gl\.uniform1f\(u\(showProg,'uSatStr'\), satStr\);/.test(main), 'uniform bind gl.uniform1f(u(showProg,\'uSatStr\'), satStr)');
ok(/grainStr, gamma, clampRad, satStr/.test(main), 'exportScene serializes satStr');
ok(/\$\('satStr'\)\.oninput/.test(main), 'UI oninput binds satStr');
ok(/\$\('satStr'\)\.value = Math\.round\(satStr \* 100\)/.test(main), 'syncSceneUI syncs satStr');
ok(/id="satStr"/.test(html), 'index.html has saturation slider');

console.log('raytracer/_saturation_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
