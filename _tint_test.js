// Lumen 色调染色(Tint)纯函数忠实移植测试：对应 GLSL uTint 分支
// c = clamp(c * mix(vec3(1.0), vec3(1.05,0.85,0.60), uTint), 0, 1)
const cl = x => Math.max(0, Math.min(1, x));
function applyTint(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const k = [1 + t*0.05, 1 - t*0.15, 1 - t*0.40];
  return [0,1,2].map(i => cl(c[i] * k[i]));
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-9)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等(中灰)', eq3(applyTint([0.5,0.5,0.5], 0), [0.5,0.5,0.5]));
ok('t=0 恒等(红)', eq3(applyTint([1,0,0], 0), [1,0,0]));
// t=1 完全染色：k=[1.05,0.85,0.60]
ok('t=1 中灰 [0.5,0.5,0.5] => [0.525,0.425,0.30]', eq3(applyTint([0.5,0.5,0.5], 1), [0.525,0.425,0.30]));
ok('t=1 白 [1,1,1] 红通道越界被钳制为 1', eq3(applyTint([1,1,1], 1), [1,0.85,0.60]));
ok('t=1 深色 [0.2,0.8,0.4] => [0.21,0.68,0.24]', eq3(applyTint([0.2,0.8,0.4], 1), [0.21,0.68,0.24]));
// t=0.5：k=[1.025,0.925,0.80]
ok('t=0.5 中灰 [0.5,0.5,0.5] => [0.5125,0.4625,0.40]', eq3(applyTint([0.5,0.5,0.5], 0.5), [0.5125,0.4625,0.40]));
ok('t=1 黑 [0,0,0] 不变', eq3(applyTint([0,0,0], 1), [0,0,0]));
// 暖化：蓝通道缩小更多，t>0 时 r>=b 且整体偏暖
ok('t=1 暖化(蓝<红)', (()=>{ const c=applyTint([0.5,0.5,0.5],1); return c[2] < c[0]; })());
// 钳制：任意输入/强度输出均在 [0,1]
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyTint(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uTint uniform', /uniform float uTint;/.test(src));
ok('main.js 含 uTint GLSL 分支', /if\(uTint > 0\.0\)\{/.test(src));
ok('main.js 绑定 uTint uniform', /gl\.uniform1f\(u\(showProg,'uTint'\), tint\);/.test(src));
ok('presetToParams 含 tint', /tint: num\(p\.tint, 0\)/.test(src));
ok('index.html 含 tint 滑块', /id="tint"/.test(html));
ok('index.html 含 tintVal 显示', /id="tintVal"/.test(html));

console.log(`\n[Lumen tint] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
