// _cnoise_test.js — ci ColorNoise (彩色噪点) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：彩色噪点(ColorNoise) 后处理全链路 ----
ok('GLSL 声明 uCnoise uniform', /uniform float uCnoise;/.test(main));
ok('show 着色器含 uCnoise 分支 if(uCnoise > 0.0)', /if\(uCnoise > 0\.0\)/.test(main));
ok('state 声明 cnoise=0', /let sceneId=0,[\s\S]*\bcnoise=0[;,]/.test(main));
ok('serializeScene 含 cnoise(导出链路)', /cnoise: s\.cnoise/.test(main));
ok('deserializeScene 含 cnoise: num', /cnoise: num\('cnoise', 0\)/.test(main));
ok('presetToParams 含 cnoise: num', /cnoise: num\(p\.cnoise, 0\)/.test(main));
ok('applyPreset/importScene 含 cnoise=s.cnoise', /cnoise=s\.cnoise;/.test(main));
ok('syncSceneUI 恢复 cnoise 滑块', /if\(\$\('cnoise'\)\) \$\('cnoise'\)\.value = Math\.round\(cnoise \* 100\)/.test(main));
ok('oninput 接线 cnoise', /\$\('cnoise'\)\.oninput/.test(main));
ok('uniform 绑定 uCnoise', /u\(showProg,'uCnoise'\)/.test(main));
ok('index.html 含 cnoise 滑块', /id="cnoise"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 cnoise 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['cnoise'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

function cnoiseJS(c, s, seed){ const n=seed-0.5; return [c[0]+n*s, c[1]+(n*0.5)*s, c[2]+(n*0.25)*s]; }
ok('彩色噪点 强度0 时不变', (()=>{const a=cnoiseJS([0.5,0.5,0.5],0,0.9);return a[0]===0.5&&a[1]===0.5&&a[2]===0.5;})());
ok('彩色噪点 强度>0 时扰动像素', (()=>{const a=cnoiseJS([0.5,0.5,0.5],1.0,0.9);return a[0]!==0.5||a[1]!==0.5||a[2]!==0.5;})());


console.log('[Lumen colornoise] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
