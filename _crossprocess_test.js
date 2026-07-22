// Lumen 交叉冲印(Cross-process)纯函数忠实移植测试：对应 GLSL uCrossprocess 分支
// 阴影染冷(蓝升红降)、高光染暖(红绿升蓝降)，模拟胶片误冲
function applyCrossprocess(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const m = l <= 0 ? 0 : (l >= 1 ? 1 : l*l*(3 - 2*l)); // smoothstep(0,1,l)
  const cool = [-0.12, -0.02, 0.14];
  const warm = [0.16, 0.08, -0.12];
  const cl = v => (v < 0 ? 0 : (v > 1 ? 1 : v));
  const r = c[0] + t*(cool[0] + (warm[0] - cool[0])*m);
  const g = c[1] + t*(cool[1] + (warm[1] - cool[1])*m);
  const b = c[2] + t*(cool[2] + (warm[2] - cool[2])*m);
  return [cl(r), cl(g), cl(b)];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyCrossprocess([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 阴影染冷：暗像素在 t=1 时蓝升(>原值) 红降(<原值)
ok('阴影 t=1 蓝升', applyCrossprocess([0.1,0.1,0.1], 1)[2] > 0.1);
ok('阴影 t=1 红降', applyCrossprocess([0.1,0.1,0.1], 1)[0] < 0.1);
// 阴影偏冷：蓝通道输出高于红通道
ok('阴影偏冷(b>r)', (()=>{ const r = applyCrossprocess([0.1,0.1,0.1], 1); return r[2] > r[0]; })());
// 高光染暖：亮像素在 t=1 时红升(>原值) 蓝降(<原值)
ok('高光 t=1 红升', applyCrossprocess([0.9,0.9,0.9], 1)[0] > 0.9);
ok('高光 t=1 蓝降', applyCrossprocess([0.9,0.9,0.9], 1)[2] < 0.9);
// 高光偏暖：红通道输出高于蓝通道
ok('高光偏暖(r>b)', (()=>{ const r = applyCrossprocess([0.9,0.9,0.9], 1); return r[0] > r[2]; })());
// 单调：t 越大效果越强（暗像素蓝升幅度随 t 增大）
ok('效果随 t 单调增强', applyCrossprocess([0.1,0.1,0.1], 1)[2] > applyCrossprocess([0.1,0.1,0.1], 0.5)[2]);
// 钳制：任意像素在 t=1 下结果都在 [0,1]
ok('输出钳制到[0,1]', (()=>{ const r = applyCrossprocess([1,0,0.5], 1); return r.every(v => v >= 0 && v <= 1); })());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uCrossprocess uniform', /uniform float uCrossprocess;/.test(src));
ok('main.js 含 uCrossprocess GLSL 分支', /if\(uCrossprocess > 0\.0\)\{/.test(src));
ok('main.js 绑定 uCrossprocess uniform', /gl\.uniform1f\(u\(showProg,'uCrossprocess'\), crossprocess\);/.test(src));
ok('presetToParams 含 crossprocess (p.)', /crossprocess: num\(p\.crossprocess, 0\)/.test(src));
ok('serializeScene 含 crossprocess', /crossprocess: num\('crossprocess', 0\)/.test(src));
ok('state 默认 crossprocess=0', /, crossprocess=0[,;]/.test(src));
ok('applyPreset 赋值 crossprocess', /crossprocess=s\.crossprocess;/.test(src));
ok('index.html 含 crossprocess 滑块', /id="crossprocess"/.test(html));
ok('index.html 含 crossprocessVal 显示', /id="crossprocessVal"/.test(html));

console.log(`\n[Lumen crossprocess] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
