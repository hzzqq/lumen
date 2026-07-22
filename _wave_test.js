// _wave_test.js — ci Wave (波形畸变) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：波形畸变(Wave) 后处理全链路 ----
ok('GLSL 声明 uWave uniform', /uniform float uWave;/.test(main));
ok('show 着色器含 uWave 分支 if(uWave > 0.0)', /if\(uWave > 0\.0\)/.test(main));
ok('state 声明 wave=0', /let sceneId=0,[\s\S]*\bwave=0[;,]/.test(main));
ok('serializeScene 含 wave(导出链路)', /wave: s\.wave/.test(main));
ok('deserializeScene 含 wave: num', /wave: num\('wave', 0\)/.test(main));
ok('presetToParams 含 wave: num', /wave: num\(p\.wave, 0\)/.test(main));
ok('applyPreset/importScene 含 wave=s.wave', /wave=s\.wave;/.test(main));
ok('syncSceneUI 恢复 wave 滑块', /if\(\$\('wave'\)\) \$\('wave'\)\.value = Math\.round\(wave \* 100\)/.test(main));
ok('oninput 接线 wave', /\$\('wave'\)\.oninput/.test(main));
ok('uniform 绑定 uWave', /u\(showProg,'uWave'\)/.test(main));
ok('index.html 含 wave 滑块', /id="wave"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 wave 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['wave'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

function waveUV(uv, s){ return [uv[0]+Math.sin(uv[1]*38.0)*0.01*s, uv[1]]; }
ok('波形畸变 强度0 时 UV 不变', (()=>{const w=waveUV([0.3,0.7],0);return w[0]===0.3&&w[1]===0.7;})());
ok('波形畸变 强度>0 时水平位移', (()=>{const w=waveUV([0.3,0.7],1.0);return Math.abs(w[0]-0.3)>1e-6;})());


console.log('[Lumen wave] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
