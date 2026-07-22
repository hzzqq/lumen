// ci141 Lumen 色温/白平衡后处理 —— 忠实移植 uTemp 的「增红减蓝/增蓝减红」逻辑 + 源码接线检查
// GLSL: if(uTemp != 0.0){ c.r = clamp(c.r*(1+0.15*uTemp),0,1); c.b = clamp(c.b*(1-0.15*uTemp),0,1); }
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植：对 RGB 应用色温(0=恒等, >0 偏暖, <0 偏冷)
function applyTemp(c, t){
  const k = 0.15 * t;
  return [
    Math.max(0, Math.min(1, c[0] * (1 + k))),   // R 暖增冷减
    c[1],                                        // G 不变
    Math.max(0, Math.min(1, c[2] * (1 - k)))     // B 暖减冷增
  ];
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }

// 1. 零色温恒等
{
  const c = [0.4, 0.2, 0.7];
  const r = applyTemp(c, 0);
  ok('temp=0 恒等', r[0] === 0.4 && r[1] === 0.2 && r[2] === 0.7);
}

// 2. 暖色(正)：R 增、B 减
{
  const r = applyTemp([0.5, 0.2, 0.5], 1.0);
  ok('temp=1 暖色 R 增(0.5→0.575)', Math.abs(r[0] - 0.575) < 1e-9);
  ok('temp=1 暖色 B 减(0.5→0.425)', Math.abs(r[2] - 0.425) < 1e-9);
  ok('temp=1 G 不变', r[1] === 0.2);
}

// 3. 冷色(负)：R 减、B 增
{
  const r = applyTemp([0.5, 0.2, 0.5], -1.0);
  ok('temp=-1 冷色 R 减(0.5→0.425)', Math.abs(r[0] - 0.425) < 1e-9);
  ok('temp=-1 冷色 B 增(0.5→0.575)', Math.abs(r[2] - 0.575) < 1e-9);
}

// 4. 钳制到 [0,1]
{
  const r = applyTemp([1, 1, 1], 1.0);
  ok('temp=1 钳制 R 不超过 1', r[0] === 1);
  ok('temp=1 B 变为 0.85', Math.abs(r[2] - 0.85) < 1e-9);
  const s = applyTemp([1, 1, 1], -1.0);
  ok('temp=-1 钳制 B 不超过 1', s[2] === 1);
}

// 5. 幅度与参数线性(0.5 → 半幅)
{
  const r = applyTemp([0.5, 0.2, 0.5], 0.5);
  ok('temp=0.5 R = 0.5*1.075', Math.abs(r[0] - 0.5375) < 1e-9);
  ok('temp=0.5 B = 0.5*0.925', Math.abs(r[2] - 0.4625) < 1e-9);
}

// 6. 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uTemp;/.test(main), 'main.js declares uniform float uTemp');
ok(/uTemp != 0\.0/.test(main), 'SHOW_FRAG applies uTemp gate');
ok(/, dither=0, temp=0(, hue=0)?(, sepia=0)?(, posterize=0)?(, letterbox=0)?(, scanline=0)?(, invert=0)?(, border=0)?(, bright=0)?[,;]/.test(main), 'state default includes temp=0');
ok(/dither: s\.dither, temp: s\.temp/.test(main), 'serializeScene includes temp');
ok(/dither: num\('dither', 0\), temp: num\('temp', 0\)/.test(main), 'deserializeScene reads temp');
ok(/temp: num\(p\.temp, 0\)/.test(main), 'presetToParams reads temp');
ok(/dither=s\.dither; temp=s\.temp;/.test(main), 'applyPreset + load set temp');
ok(/if\(\$\('temp'\)\) \$\('temp'\)\.value = Math\.round\(temp \* 100\);/.test(main), 'syncSceneUI sets temp slider');
ok(/dither, temp(, hue)?(, sepia)?(, posterize)?(, letterbox)?(, scanline)?/.test(main), 'exportScene object includes temp');
ok(/gl\.uniform1f\(u\(showProg,'uTemp'\), temp\);/.test(main), 'uniform bind uTemp');
ok(/\$\('temp'\)\.oninput/.test(main), 'main.js binds temp slider');
ok(/id="temp"/.test(html) && /id="tempVal"/.test(html), 'index.html has temp slider');

console.log('raytracer/_temp_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
