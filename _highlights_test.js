// Lumen 高光压缩(Highlights)纯函数忠实移植测试：对应 GLSL uHighlights 分支
// 仅对亮度 > 0.55 的高亮区做肩式滚降：h = max(l-0.55,0)/0.45; c *= (1 - t*h*0.5)
function applyHighlights(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const h = Math.max(l - 0.55, 0) / 0.45;
  const k = 1 - t * h * 0.5;
  return [c[0]*k, c[1]*k, c[2]*k];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);
const rng = c => Math.max(...c) - Math.min(...c);

// t=0 恒等
ok('t=0 恒等', eq3(applyHighlights([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 暗部不受影响(luma<0.55 => h=0 => 不变)
ok('暗色 [0.1,0.2,0.3] t=1 不变', eq3(applyHighlights([0.1,0.2,0.3], 1), [0.1,0.2,0.3]));
// t=1 亮色被压缩
ok('t=1 亮色 [0.9,0.9,0.9] => [0.55,0.55,0.55]', eq3(applyHighlights([0.9,0.9,0.9], 1), [0.55,0.55,0.55]));
// t=0.5 半插值
ok('t=0.5 [0.9,0.9,0.9] => [0.725,0.725,0.725]', eq3(applyHighlights([0.9,0.9,0.9], 0.5), [0.725,0.725,0.725]));
// 仅压缩高光：亮色极差已为 0，验证“越亮压得越多”——纯白被压到 0.5
ok('t=1 纯白 [1,1,1] => [0.5,0.5,0.5]', eq3(applyHighlights([1,1,1], 1), [0.5,0.5,0.5]));
// 单调：t 越大高光压得越多
ok('t 越大亮色压得越多', applyHighlights([0.9,0.9,0.9], 1)[0] < applyHighlights([0.9,0.9,0.9], 0.2)[0]);
// 钳制：输出恒在 [0,1]
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyHighlights(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uHighlights uniform', /uniform float uHighlights;/.test(src));
ok('main.js 含 uHighlights GLSL 分支', /if\(uHighlights > 0\.0\)\{/.test(src));
ok('main.js 绑定 uHighlights uniform', /gl\.uniform1f\(u\(showProg,'uHighlights'\), highlights\);/.test(src));
ok('presetToParams 含 highlights', /highlights: num\(p\.highlights, 0\)/.test(src));
ok('index.html 含 highlights 滑块', /id="highlights"/.test(html));
ok('index.html 含 highlightsVal 显示', /id="highlightsVal"/.test(html));

console.log(`\n[Lumen highlights] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
