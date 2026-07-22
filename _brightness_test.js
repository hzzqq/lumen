// ci173 Lumen 亮度增益(brightness)后处理 —— applyBrightness 行为测试(c*=(1+t) 钳制 [0,1]) + 接线检查
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植：c[i] = clamp(c[i] * (1 + t), 0, 1)
function applyBrightness(c, t){
  const out = new Array(c.length);
  for(let i = 0; i < c.length; i++) out[i] = Math.min(1, Math.max(0, c[i] * (1 + t)));
  return out;
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
const clamp01 = v => Math.min(1, Math.max(0, v));

// 1. 强度 0 → 恒等
{
  const a = [0.1, 0.5, 0.9, 0.0, 0.3]; const b = applyBrightness(a.slice(), 0);
  ok('t=0 恒等', a.every((v, i) => Math.abs(v - b[i]) < 1e-9));
}
// 2. 强度 >0 → 提亮(原 >0 的像素更亮)，0 仍 0
{
  const a = [0.1, 0.5, 0.9, 0.0]; const b = applyBrightness(a.slice(), 0.5);
  ok('t=0.5：0.1→0.15', Math.abs(b[0] - 0.15) < 1e-9);
  ok('t=0.5：0.5→0.75', Math.abs(b[1] - 0.75) < 1e-9);
  ok('t=0.5：0.9→1.0(钳制)', Math.abs(b[2] - 1.0) < 1e-9);
  ok('t=0.5：0 仍 0', b[3] === 0);
}
// 3. 单调递增：t 越大越亮(对 >0 像素)
{
  const a = [0.4]; const b1 = applyBrightness(a.slice(), 0.2)[0], b2 = applyBrightness(a.slice(), 0.8)[0];
  ok('亮度随强度单调上升', b1 < b2);
}
// 4. 范围：输出 ∈ [0,1]
{
  const a = [0.0, 0.2, 0.7, 1.0, 0.99]; const b = applyBrightness(a, 1.0);
  ok('输出在 [0,1]', b.every(v => v >= -1e-9 && v <= 1 + 1e-9));
}
// 5. 接线检查（子串匹配，新增 bright 不影响既有断言）
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uBright;/.test(main), 'main.js 声明 uniform float uBright');
ok(/if\(uBright > 0\.0\)/.test(main), 'GLSL 链条含 uBright 分支');
ok(/gl\.uniform1f\(u\(showProg,'uBright'\)/.test(main), 'uniform 绑定 uBright');
ok(/bright=0[,;]/.test(main), 'state 默认含 bright=0');
ok(/bright: s\.bright/.test(main), 'serialize 含 bright');
ok(/bright: num\('bright', 0\)/.test(main), 'deserialize 含 bright');
ok(/bright: num\(p\.bright, 0\)/.test(main), 'presetToParams 含 bright');
ok(/bright=s\.bright/.test(main), 'applyPreset/loadScene 含 bright');
ok(/Math\.round\(bright \* 100\)/.test(main) && /\$\('bright'\)/.test(main), 'syncSceneUI 同步 bright 滑块');
ok(/\$\('bright'\)\.oninput/.test(main), 'oninput 绑定 bright 滑块');
ok(/id="bright"/.test(html) && /亮度增益/.test(html), 'index.html 含「亮度增益」滑块');

console.log('raytracer/_brightness_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
