// _ripple_test.js — ci Ripple (水波纹) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：水波纹(Ripple) 后处理全链路 ----
ok('GLSL 声明 uRipple uniform', /uniform float uRipple;/.test(main));
ok('show 着色器含 uRipple 分支 if(uRipple > 0.0)', /if\(uRipple > 0\.0\)/.test(main));
ok('state 声明 ripple=0', /let sceneId=0,[\s\S]*\bripple=0[;,]/.test(main));
ok('serializeScene 含 ripple(导出链路)', /ripple: s\.ripple/.test(main));
ok('deserializeScene 含 ripple: num', /ripple: num\('ripple', 0\)/.test(main));
ok('presetToParams 含 ripple: num', /ripple: num\(p\.ripple, 0\)/.test(main));
ok('applyPreset/importScene 含 ripple=s.ripple', /ripple=s\.ripple;/.test(main));
ok('syncSceneUI 恢复 ripple 滑块', /if\(\$\('ripple'\)\) \$\('ripple'\)\.value = Math\.round\(ripple \* 100\)/.test(main));
ok('oninput 接线 ripple', /\$\('ripple'\)\.oninput/.test(main));
ok('uniform 绑定 uRipple', /u\(showProg,'uRipple'\)/.test(main));
ok('index.html 含 ripple 滑块', /id="ripple"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 ripple 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['ripple'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

function rippleUV(uv, s){ const p=[uv[0]-0.5,uv[1]-0.5]; const rad=Math.hypot(p[0],p[1]); const disp=Math.sin(rad*40.0)*0.012*s; const n=rad>1e-6?[p[0]/rad,p[1]/rad]:[0,0]; return [uv[0]+n[0]*disp, uv[1]+n[1]*disp]; }
ok('水波纹 强度0 时 UV 不变', (()=>{const w=rippleUV([0.5,0.5],0);return w[0]===0.5&&w[1]===0.5;})());
ok('水波纹 强度>0 时产生径向位移', (()=>{const w=rippleUV([0.6,0.6],1.0);return Math.abs(w[0]-0.6)>1e-9||Math.abs(w[1]-0.6)>1e-9;})());


console.log('[Lumen ripple] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
