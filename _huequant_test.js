// _huequant_test.js — ci HueQuantize (色相分层) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：色相分层(HueQuantize) 后处理全链路 ----
ok('GLSL 声明 uHuequant uniform', /uniform float uHuequant;/.test(main));
ok('show 着色器含 uHuequant 分支 if(uHuequant > 0.0)', /if\(uHuequant > 0\.0\)/.test(main));
ok('state 声明 huequant=0', /let sceneId=0,[\s\S]*\bhuequant=0[;,]/.test(main));
ok('serializeScene 含 huequant(导出链路)', /huequant: s\.huequant/.test(main));
ok('deserializeScene 含 huequant: num', /huequant: num\('huequant', 0\)/.test(main));
ok('presetToParams 含 huequant: num', /huequant: num\(p\.huequant, 0\)/.test(main));
ok('applyPreset/importScene 含 huequant=s.huequant', /huequant=s\.huequant;/.test(main));
ok('syncSceneUI 恢复 huequant 滑块', /if\(\$\('huequant'\)\) \$\('huequant'\)\.value = Math\.round\(huequant \* 100\)/.test(main));
ok('oninput 接线 huequant', /\$\('huequant'\)\.oninput/.test(main));
ok('uniform 绑定 uHuequant', /u\(showProg,'uHuequant'\)/.test(main));
ok('index.html 含 huequant 滑块', /id="huequant"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 huequant 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['huequant'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

function rgb2hsv(c){ const mx=Math.max(c[0],c[1],c[2]), mn=Math.min(c[0],c[1],c[2]), ch=mx-mn; if(ch<1e-6) return [0,0,mx]; let h; if(mx===c[0])h=((c[1]-c[2])/ch)%6; else if(mx===c[1])h=(c[2]-c[0])/ch+2; else h=(c[0]-c[1])/ch+4; h/=6; if(h<0)h+=1; return [h, ch/Math.max(mx,1e-6), mx]; }
function hsv2rgb(h,s,v){ const i=Math.floor(h*6), f=h*6-i; const p=v*(1-s), q=v*(1-f*s), t=v*(1-(1-f)*s); const m=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][((i%6)+6)%6]; return m; }
function hueQuantJS(c, lv){ const [h,s,v]=rgb2hsv(c); const q=Math.floor(h*lv+0.5)/lv; return hsv2rgb(q,s,v); }
ok('色相分层 强度0 时不变(mix权重0)', (()=>{const c=[0.8,0.2,0.3];const o=mixv(c,c,0);return o[0]===c[0];})());
ok('色相分层 高强度将相近色相合并为同档', (()=>{ const a=hueQuantJS([0.8,0.2,0.2],2), b=hueQuantJS([0.85,0.25,0.2],2); const ha=rgb2hsv(a)[0], hb=rgb2hsv(b)[0]; return Math.abs(ha-hb)<1e-6; })());


console.log('[Lumen huequantize] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
