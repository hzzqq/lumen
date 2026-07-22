// Lumen 粉彩(Pastel)纯函数忠实移植测试：对应 GLSL uPastel + 内联分支
// 去饱和(向亮度 mix 0.4) 后向白提亮(mix 0.25)，再按强度 mix 到原图。
function applyPastel(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const dr = c[0] + (l - c[0]) * 0.4;
  const dg = c[1] + (l - c[1]) * 0.4;
  const db = c[2] + (l - c[2]) * 0.4;
  const sr = dr + (1 - dr) * 0.25;
  const sg = dg + (1 - dg) * 0.25;
  const sb = db + (1 - db) * 0.25;
  return [c[0] + (sr - c[0]) * t, c[1] + (sg - c[1]) * t, c[2] + (sb - c[2]) * t];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);
const min3 = (v)=> Math.min(v[0], v[1], v[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyPastel([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 纯黑 t=1 => 提亮到 (0.25,0.25,0.25)
ok('纯黑 t=1 => 浅灰(0.25)', eq3(applyPastel([0,0,0], 1), [0.25,0.25,0.25]));
// 纯白 t=1 仍为白
ok('纯白 t=1 仍为白', eq3(applyPastel([1,1,1], 1), [1,1,1]));
// 饱和红 t=1 => 粉彩红：红仍最高，绿≈蓝(去饱和)，且绿蓝被提亮(>0)
ok('饱和红 t=1 => 粉彩红(红最高, 绿蓝提亮且相近)', (()=>{ const r = applyPastel([1,0,0], 1); return r[0] > r[1] && t(r[1], r[2]) && r[1] > 0; })());
// 粉彩提升最暗通道(整体变亮/柔和)
ok('粉彩提升最暗通道(变柔和)', (()=>{ const r = applyPastel([1,0,0], 1); return min3(r) >= min3([1,0,0]); })());
// 中灰 t=1 => 比原色更亮(0.625)
ok('中灰 t=1 提亮到 0.625', eq3(applyPastel([0.5,0.5,0.5], 1), [0.625,0.625,0.625]));
// 单调：t 越大偏离原色越多
ok('效果随 t 单调增强', (()=>{
  const base=[0.8,0.3,0.1];
  const d = (v)=> Math.abs(v[0]-0.8)+Math.abs(v[1]-0.3)+Math.abs(v[2]-0.1);
  return d(applyPastel(base,1)) > d(applyPastel(base,0.5));
})());
// 输出在 [0,1]
ok('输出在[0,1]', (()=>{ const r = applyPastel([1,0,0.5], 1); return r.every(v => v>=0 && v<=1); })());
// 多通道混合验证(蓝紫 [0.3,0.2,0.9])
ok('蓝紫 t=1 提亮且保持蓝最高', (()=>{ const r = applyPastel([0.3,0.2,0.9], 1); return r[2] >= r[0] && r[2] >= r[1] && min3(r) > 0.2; })());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uPastel uniform', /uniform float uPastel;/.test(src));
ok('main.js 含 uPastel GLSL 分支', /if\(uPastel > 0\.0\)\{/.test(src));
ok('main.js 绑定 uPastel uniform', /gl\.uniform1f\(u\(showProg,'uPastel'\), pastel\);/.test(src));
ok('presetToParams 含 pastel (p.)', /pastel: num\(p\.pastel, 0\)/.test(src));
ok('serializeScene 含 pastel', /pastel: num\('pastel', 0\)/.test(src));
ok('state 默认 pastel=0', /, pastel=0[,;]/.test(src));
ok('applyPreset 赋值 pastel', /pastel=s\.pastel;/.test(src));
ok('index.html 含 pastel 滑块', /id="pastel"/.test(html));
ok('index.html 含 pastelVal 显示', /id="pastelVal"/.test(html));

console.log(`\n[Lumen pastel] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
