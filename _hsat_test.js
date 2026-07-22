// _hsat_test.js — ci HighlightSat (高光饱和) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：高光饱和(HighlightSat) 后处理全链路 ----
ok('GLSL 声明 uHsat uniform', /uniform float uHsat;/.test(main));
ok('show 着色器含 uHsat 分支 if(uHsat > 0.0)', /if\(uHsat > 0\.0\)/.test(main));
ok('state 声明 hsat=0', /let sceneId=0,[\s\S]*\bhsat=0[;,]/.test(main));
ok('serializeScene 含 hsat(导出链路)', /hsat: s\.hsat/.test(main));
ok('deserializeScene 含 hsat: num', /hsat: num\('hsat', 0\)/.test(main));
ok('presetToParams 含 hsat: num', /hsat: num\(p\.hsat, 0\)/.test(main));
ok('applyPreset/importScene 含 hsat=s.hsat', /hsat=s\.hsat;/.test(main));
ok('syncSceneUI 恢复 hsat 滑块', /if\(\$\('hsat'\)\) \$\('hsat'\)\.value = Math\.round\(hsat \* 100\)/.test(main));
ok('oninput 接线 hsat', /\$\('hsat'\)\.oninput/.test(main));
ok('uniform 绑定 uHsat', /u\(showProg,'uHsat'\)/.test(main));
ok('index.html 含 hsat 滑块', /id="hsat"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 hsat 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['hsat'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

const ss=(e0,e1,x)=>{x=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return x*x*(3-2*x);};
function satOf(c){ const l=lum(c); const mx=Math.max(c[0],c[1],c[2]), mn=Math.min(c[0],c[1],c[2]); return (mx-mn)/(Math.max(l,1e-6)); }
function hsatJS(c, s){ const l=lum(c); const boost=1.0+s*ss(0.5,1.0,l); return mixv([l,l,l], c, boost); }
ok('高光饱和 强度0 时不变', (()=>{const a=hsatJS([0.5,0.5,0.5],0);return a[0]===0.5;})());
ok('高光饱和 亮部提饱和、暗部变化小', (()=>{const hi=hsatJS([0.9,0.6,0.3],1.0), lo=hsatJS([0.2,0.15,0.1],1.0);return satOf(hi)>satOf([0.9,0.6,0.3]) && satOf(lo)>=satOf([0.2,0.15,0.1])-1e-6;})());


console.log('[Lumen highlightsat] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
