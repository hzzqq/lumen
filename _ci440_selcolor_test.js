// _ci440_selcolor_test.js — 验证 ci440：Lumen 选择性颜色(Selective Color)后处理
// 忠实移植 selColor 的 GLSL 数学到纯 JS，断言不变量；
// 并校验 main.js / index.html 已接线(uniform + apply 分支 + UI 控件)，保证不是“假实现”。
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
function clamp(v, lo, hi){ return Math.min(Math.max(v, lo), hi); }

// --- 忠实移植 rgb2hsv / smoothstep / selColor ---
function rgb2hsv(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if(d !== 0){
    if(mx === r) h = ((g - b) / d) % 6;
    else if(mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if(h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function smoothstep(e0, e1, x){
  let t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function selColor(c, hueDeg, rangeDeg, strength){
  if(strength <= 0) return c.slice();
  const hsv = rgb2hsv(c[0], c[1], c[2]);
  const h = hsv[0];
  let diff = Math.abs(h - hueDeg);
  diff = Math.min(diff, 360 - diff);          // 环形最短角距(跨 0/360 边界)
  const feather = Math.max(rangeDeg * 0.35, 8.0);
  const keep = 1 - smoothstep(rangeDeg - feather, rangeDeg, diff);
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const t = strength * (1 - keep);
  return [clamp(c[0] + (l - c[0]) * t, 0, 1),
          clamp(c[1] + (l - c[1]) * t, 0, 1),
          clamp(c[2] + (l - c[2]) * t, 0, 1)];
}

// 1. strength=0 恒为恒等(任意颜色)
ok('strength=0 恒等', (()=>{ const c=[0.2,0.5,0.9]; const o=selColor(c,0,45,0); return approx(o[0],c[0])&&approx(o[1],c[1])&&approx(o[2],c[2]); })());
ok('strength=0 红恒等', (()=>{ const o=selColor([1,0,0],123,10,0); return approx(o[0],1)&&approx(o[1],0)&&approx(o[2],0); })());

// 2. 带内(红色 hue≈0, 目标 0, 宽 45)保留原色
ok('带内保留原色', (()=>{ const o=selColor([1,0,0],0,45,1); return approx(o[0],1,1e-3)&&approx(o[1],0,1e-3)&&approx(o[2],0,1e-3); })());

// 3. 带外(绿色 hue≈120, 目标 0, 宽 45, 强度 1)完全去色为灰(l=0.587)
ok('带外去色为灰', (()=>{ const o=selColor([0,1,0],0,45,1); const l=0.587; return approx(o[0],l,1e-3)&&approx(o[1],l,1e-3)&&approx(o[2],l,1e-3); })());

// 4. 部分强度(带外 strength=0.5)结果介于原色与灰之间
ok('部分强度介于原色与灰之间', (()=>{
  const c=[0,1,0], o=selColor(c,0,45,0.5), l=0.587;
  return o[1] < c[1] && o[1] > l && approx(o[0],o[2]);
})());

// 5. 环形角距：目标 350 的颜色 hue=10 应判定带内(diff=20)，而非带外
ok('环形角距带内', (()=>{ const o=selColor([1,0,0],350,45,1); return approx(o[0],1,1e-3); })());

// 6. 带外比带内去色更强(同色同强度)
ok('带内去色弱于带外', (()=>{
  const c=[0,1,0];
  const inB = selColor(c, 120, 45, 1);   // 绿, 目标=其自身色相 -> 保留
  const outB = selColor(c, 0, 45, 1);    // 绿, 目标=红 -> 去色
  return outB[1] < inB[1];
})());

// --- 接线校验：main.js 实际包含 uniform / apply 分支 / 绑定 / 序列化 ---
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

ok('main.js 声明 uniform uSelColor', /uniform float uSelColor;/.test(src));
ok('main.js 声明 uniform uSelHue', /uniform float uSelHue;/.test(src));
ok('main.js 声明 uniform uSelRange', /uniform float uSelRange;/.test(src));
ok('main.js SHOW 分支调用 selColor', /if\(uSelColor > 0\.0\)\{ c = selColor\(/.test(src));
ok('main.js 定义 selColor(vec3,float,float,float)', /vec3 selColor\(vec3 c, float hueDeg, float rangeDeg, float strength\)/.test(src));
ok('main.js 绑定 uSelColor', /gl\.uniform1f\(u\(showProg,'uSelColor'\), selColor\);/.test(src));
ok('main.js 绑定 uSelHue', /gl\.uniform1f\(u\(showProg,'uSelHue'\), selHue\);/.test(src));
ok('main.js 绑定 uSelRange', /gl\.uniform1f\(u\(showProg,'uSelRange'\), selRange\);/.test(src));
ok('presetToParams 含 selColor', /selColor: num\(p\.selColor, 0\)/.test(src));
ok('presetToParams 含 selHue 钳制', /selHue: Math\.max\(0, Math\.min\(360, num\(p\.selHue, 0\)\)\)/.test(src));
ok('presetToParams 含 selRange 钳制', /selRange: Math\.max\(0, Math\.min\(180, num\(p\.selRange, 45\)\)\)/.test(src));
ok('serializeScene 含 selColor', /selColor, selHue, selRange/.test(src));
ok('index.html 含 selColor 控件', /id="selColor"/.test(html));
ok('index.html 含 selHue 控件', /id="selHue"/.test(html));
ok('index.html 含 selRange 控件', /id="selRange"/.test(html));
ok('index.html oninput 绑定 selColor', /\$\('selColor'\)\.oninput/.test(html) || /\$\('selColor'\)\.oninput/.test(src));

console.log('\nci440 selColor: pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
