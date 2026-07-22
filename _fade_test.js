// Lumen 褪色(Fade)纯函数忠实移植测试：对应 GLSL uFade 分支
// step1 去饱和 0.35t: c = mix(c, luma, 0.35t); step2 抬黑 0.30t: c = mix(c, (0.92,0.90,0.86), 0.30t)
function applyFade(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  let r = c[0] + (l - c[0]) * 0.35 * t;
  let g = c[1] + (l - c[1]) * 0.35 * t;
  let b = c[2] + (l - c[2]) * 0.35 * t;
  r = r + (0.92 - r) * 0.30 * t;
  g = g + (0.90 - g) * 0.30 * t;
  b = b + (0.86 - b) * 0.30 * t;
  return [r, g, b];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);
const rng = c => Math.max(...c) - Math.min(...c);

// t=0 恒等
ok('t=0 恒等', eq3(applyFade([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// t=1 数值
ok('t=1 [0.2,0.5,0.8] => [0.47918,0.60968,0.73418]', eq3(applyFade([0.2,0.5,0.8], 1), [0.47918,0.60968,0.73418]));
// t=0.5 半插值
ok('t=0.5 [0.2,0.5,0.8] => [0.34636,0.55373,0.75811]', eq3(applyFade([0.2,0.5,0.8], 0.5), [0.34636,0.55373,0.75811]));
// t=1 纯红
ok('t=1 纯红 [1,0,0] => [0.78309,0.32209,0.31009]', eq3(applyFade([1,0,0], 1), [0.78309,0.32209,0.31009]));
// 降饱和 + 抬黑：输出极差缩小(更灰更柔)
ok('t=1 降低对比(通道极差缩小)', rng(applyFade([0.2,0.5,0.8], 1)) < rng([0.2,0.5,0.8]));
// 单调：t 越大越接近褪色极限
ok('t 越大越接近褪色极限(通道极差缩小)', rng(applyFade([0.2,0.5,0.8], 0.8)) < rng(applyFade([0.2,0.5,0.8], 0.2)));
// 钳制
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyFade(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uFade uniform', /uniform float uFade;/.test(src));
ok('main.js 含 uFade GLSL 分支', /if\(uFade > 0\.0\)\{/.test(src));
ok('main.js 绑定 uFade uniform', /gl\.uniform1f\(u\(showProg,'uFade'\), fade\);/.test(src));
ok('presetToParams 含 fade', /fade: num\(p\.fade, 0\)/.test(src));
ok('index.html 含 fade 滑块', /id="fade"/.test(html));
ok('index.html 含 fadeVal 显示', /id="fadeVal"/.test(html));

console.log(`\n[Lumen fade] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
