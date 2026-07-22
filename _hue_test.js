// ci145 Lumen 色相旋转(Hue Shift) —— 纯函数 hueShift + 全链路接线断言
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };

// ---- 纯函数：RGB↔HSV 互转 + 色相平移（与 GLSL 同义，用于行为校验）----
function rgb2hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [r + m, g + m, b + m];
}
function hueShift(c, deg) {
  const [h, s, v] = rgb2hsv(c[0], c[1], c[2]);
  let nh = (h + deg) % 360; if (nh < 0) nh += 360;
  return hsv2rgb(nh, s, v);
}
const vnear = (a, b, e = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e);

// ---- 行为：色相旋转 ----
ok('红 0° 不变', vnear(hueShift([1, 0, 0], 0), [1, 0, 0]));
ok('红 120° → 绿', vnear(hueShift([1, 0, 0], 120), [0, 1, 0]));
ok('红 240° → 蓝', vnear(hueShift([1, 0, 0], 240), [0, 0, 1]));
ok('红 360° = 原色(恒等)', vnear(hueShift([1, 0, 0], 360), [1, 0, 0]));
ok('绿 120° → 蓝', vnear(hueShift([0, 1, 0], 120), [0, 0, 1]));
ok('负旋转 -120° 红→蓝', vnear(hueShift([1, 0, 0], -120), [0, 0, 1]));
ok('灰阶不变(无饱和度)', vnear(hueShift([0.5, 0.5, 0.5], 90), [0.5, 0.5, 0.5]));

// ---- 接线：GLSL ----
ok('SHOW_FRAG 声明 uniform float uHue', main.includes('uniform float uHue;'));
ok('GLSL 含 hueShift 辅助函数', main.includes('vec3 hueShift(vec3 c, float deg)'));
ok('main 应用 if(uHue != 0.0) c = hueShift', main.includes('if(uHue != 0.0){ c = hueShift(c, uHue); }'));

// ---- 接线：JS 状态/序列化/预设/UI/绑定 ----
ok('state 初始化含 hue=0', /temp=0, hue=0(, sepia=0)?(, posterize=0)?(, letterbox=0)?(, scanline=0)?;/.test(main));
ok('serializeScene 含 hue: s.hue', main.includes('temp: s.temp, hue: s.hue'));
ok('deserializeScene 含 num(hue,0)', main.includes("temp: num('temp', 0), hue: num('hue', 0)"));
ok('presetToParams 含 num(p.hue,0)', main.includes("temp: num(p.temp, 0), hue: num(p.hue, 0)"));
ok('applyPreset 含 hue=s.hue', main.includes('temp=s.temp; hue=s.hue;'));
ok('loadScene 含 hue=s.hue', main.includes('temp=s.temp; hue=s.hue;'));
ok('syncSceneUI 同步 #hue', main.includes("if($('hue')) $('hue').value = Math.round(hue);"));
ok('exportScene 含 hue', /sharpen, dither, temp, hue(, sepia)?(, posterize)?(, letterbox)?(, scanline)? \}\);/.test(main));
ok('UI handler 绑定 #hue', main.includes("$('hue').oninput"));
ok('uniform bind uHue', main.includes("gl.uniform1f(u(showProg,'uHue'), hue);"));
ok('index.html 含色相 Hue 滑块', html.includes('id="hue"'));

console.log('raytracer/_hue_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
