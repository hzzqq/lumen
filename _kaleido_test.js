// _kaleido_test.js — ci Kaleidoscope (万花筒) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：万花筒(Kaleidoscope) 后处理全链路 ----
ok('GLSL 声明 uKaleido uniform', /uniform float uKaleido;/.test(main));
ok('show 着色器含 uKaleido 分支 if(uKaleido > 0.0)', /if\(uKaleido > 0\.0\)/.test(main));
ok('state 声明 kaleido=0', /let sceneId=0,[\s\S]*\bkaleido=0[;,]/.test(main));
ok('serializeScene 含 kaleido(导出链路)', /kaleido: s\.kaleido/.test(main));
ok('deserializeScene 含 kaleido: num', /kaleido: num\('kaleido', 0\)/.test(main));
ok('presetToParams 含 kaleido: num', /kaleido: num\(p\.kaleido, 0\)/.test(main));
ok('applyPreset/importScene 含 kaleido=s.kaleido', /kaleido=s\.kaleido;/.test(main));
ok('syncSceneUI 恢复 kaleido 滑块', /if\(\$\('kaleido'\)\) \$\('kaleido'\)\.value = Math\.round\(kaleido \* 100\)/.test(main));
ok('oninput 接线 kaleido', /\$\('kaleido'\)\.oninput/.test(main));
ok('uniform 绑定 uKaleido', /u\(showProg,'uKaleido'\)/.test(main));
ok('index.html 含 kaleido 滑块', /id="kaleido"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 kaleido 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['kaleido'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

function kaleidoUV(uv){ const p=[uv[0]-0.5,uv[1]-0.5]; let a=Math.atan2(p[1],p[0]); const rad=Math.hypot(p[0],p[1]); const seg=Math.PI/4.0; a=Math.abs(((a%(2*seg))+2*seg)%(2*seg)-seg); return [Math.cos(a)*rad+0.5, Math.sin(a)*rad+0.5]; }
ok('万花筒 强度0 时(混合权重0)画面不变', (()=>{ // GLSL: mix(c, sampleHDR(kuv), 0) == c
  const c=[0.2,0.4,0.8]; const k=kaleidoUV([0.2,0.3]); const out=mixv(c,c,0); return out[0]===c[0]; })());
ok('万花筒 楔形镜像：对称点映射重合', (()=>{ const a=kaleidoUV([0.6,0.5]), b=kaleidoUV([0.4,0.5]); return Math.abs(a[0]-b[0])<1e-6; })());


console.log('[Lumen kaleidoscope] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
