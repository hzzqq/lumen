// Lumen 红外假彩(Infrared)纯函数忠实移植测试：对应 GLSL uInfrared + infraredMap
// 按亮度做热成像伪彩映射(黑→深紫→红→橙→黄→白)，再按强度 mix 到原图。
function applyInfrared(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const cl = Math.max(0, Math.min(1, l));
  const mix = (a,b,f)=> a+(b-a)*f;
  let r,g,b;
  if(cl < 0.2){ const f=cl/0.2; r=mix(0,0.30,f); g=mix(0,0,f); b=mix(0,0.40,f); }
  else if(cl < 0.4){ const f=(cl-0.2)/0.2; r=mix(0.30,0.85,f); g=mix(0,0.05,f); b=mix(0.40,0.10,f); }
  else if(cl < 0.6){ const f=(cl-0.4)/0.2; r=mix(0.85,1.0,f); g=mix(0.05,0.55,f); b=mix(0.10,0.0,f); }
  else if(cl < 0.8){ const f=(cl-0.6)/0.2; r=mix(1.0,1.0,f); g=mix(0.55,0.95,f); b=mix(0.0,0.6,f); }
  else { const f=(cl-0.8)/0.2; r=mix(1.0,1.0,f); g=mix(0.95,1.0,f); b=mix(0.6,1.0,f); }
  return [c[0]+(r-c[0])*t, c[1]+(g-c[1])*t, c[2]+(b-c[2])*t];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);
const max3 = (v)=> Math.max(v[0], v[1], v[2]);

ok('t=0 恒等', eq3(applyInfrared([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
ok('纯黑 t=1 => 黑(0,0,0)', eq3(applyInfrared([0,0,0], 1), [0,0,0]));
ok('纯白 t=1 => 白(1,1,1)', eq3(applyInfrared([1,1,1], 1), [1,1,1]));
ok('中灰 t=1 => 偏红热区(0.925,0.30,0.05)', (()=>{ const r = applyInfrared([0.5,0.5,0.5], 1); return t(r[0],0.925) && t(r[1],0.30) && t(r[2],0.05); })());
ok('蓝 t=1 => 暗紫(低亮度, 蓝>=红, 绿=0)', (()=>{ const r = applyInfrared([0,0,1], 1); return r[2] >= r[0] && r[1] === 0 && r[0] > 0; })());
ok('红 t=1 => 中热区(红仍最高)', (()=>{ const r = applyInfrared([1,0,0], 1); return r[0] > r[1] && r[0] > r[2]; })());
ok('效果随 t 单调增强', (()=>{ const base=[0.8,0.3,0.1]; const d = v=>Math.abs(v[0]-0.8)+Math.abs(v[1]-0.3)+Math.abs(v[2]-0.1); return d(applyInfrared(base,1)) > d(applyInfrared(base,0.5)); })());
ok('输出在[0,1]', (()=>{ const r = applyInfrared([1,0,0.5], 1); return r.every(v => v>=0 && v<=1); })());
ok('高亮度映射更亮', (()=>{ const a = applyInfrared([0.2,0.2,0.2], 1); const b = applyInfrared([0.9,0.9,0.9], 1); return max3(b) >= max3(a); })());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uInfrared uniform', /uniform float uInfrared;/.test(src));
ok('main.js 含 uInfrared GLSL 分支', /if\(uInfrared > 0\.0\)\{/.test(src));
ok('main.js 绑定 uInfrared uniform', /gl\.uniform1f\(u\(showProg,'uInfrared'\), infrared\);/.test(src));
ok('presetToParams 含 infrared (p.)', /infrared: num\(p\.infrared, 0\)/.test(src));
ok('serializeScene 含 infrared', /infrared: num\('infrared', 0\)/.test(src));
ok('state 默认 infrared=0', /infrared=0[,;]/.test(src));
ok('applyPreset 赋值 infrared', /infrared=s\.infrared;/.test(src));
ok('index.html 含 infrared 滑块', /id="infrared"/.test(html));
ok('index.html 含 infraredVal 显示', /id="infraredVal"/.test(html));

console.log(`\n[Lumen infrared] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
