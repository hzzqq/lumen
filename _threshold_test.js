// Lumen 阈值二值化(Threshold)纯函数忠实移植测试：对应 GLSL uThreshold 分支
// 按亮度阈值 t 将画面转为黑白：luma<=t 转黑, 否则转白（GLSL 侧 step(uThreshold, l)）
function applyThreshold(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const v = l >= t ? 1 : 0;
  return [v, v, v];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyThreshold([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// t=0.5：中灰 luma≈0.444 < 0.5 => 黑
ok('t=0.5 [0.2,0.5,0.8] => 黑', eq3(applyThreshold([0.2,0.5,0.8], 0.5), [0,0,0]));
// t=0.5：亮灰 luma=0.8 >= 0.5 => 白
ok('t=0.5 [0.8,0.8,0.8] => 白', eq3(applyThreshold([0.8,0.8,0.8], 0.5), [1,1,1]));
// t=0.5：纯白 => 白
ok('t=0.5 纯白 => 白', eq3(applyThreshold([1,1,1], 0.5), [1,1,1]));
// t=0.5：纯黑 => 黑
ok('t=0.5 纯黑 => 黑', eq3(applyThreshold([0,0,0], 0.5), [0,0,0]));
// t=1.0：仅纯白保留为白，其余转黑（luma<1）
ok('t=1.0 [0.5,0.5,0.5] => 黑', eq3(applyThreshold([0.5,0.5,0.5], 1), [0,0,0]));
ok('t=0.99 纯白 => 白', eq3(applyThreshold([1,1,1], 0.99), [1,1,1]));
// 单调：阈值越高，同一中灰从白变黑的临界点（t=0.4 白, t=0.6 黑）
ok('阈值升高中灰由白变黑', applyThreshold([0.5,0.5,0.5], 0.4)[0] === 1 && applyThreshold([0.5,0.5,0.5], 0.6)[0] === 0);
// 输出恒为黑白（每像素三通道相等）
ok('输出三通道相等(黑白)', (()=>{ const r = applyThreshold([0.3,0.6,0.9], 0.5); return r[0]===r[1] && r[1]===r[2]; })());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uThreshold uniform', /uniform float uThreshold;/.test(src));
ok('main.js 含 uThreshold GLSL 分支', /if\(uThreshold > 0\.0\)\{/.test(src));
ok('main.js 绑定 uThreshold uniform', /gl\.uniform1f\(u\(showProg,'uThreshold'\), threshold\);/.test(src));
ok('presetToParams 含 threshold (p.)', /threshold: num\(p\.threshold, 0\)/.test(src));
ok('serializeScene 含 threshold', /threshold: num\('threshold', 0\)/.test(src));
ok('state 默认 threshold=0', /, threshold=0[,;]/.test(src));
ok('applyPreset 赋值 threshold', /threshold=s\.threshold;/.test(src));
ok('index.html 含 threshold 滑块', /id="threshold"/.test(html));
ok('index.html 含 thresholdVal 显示', /id="thresholdVal"/.test(html));

console.log(`\n[Lumen threshold] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
