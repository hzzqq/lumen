// Lumen 漂白旁路(Bleach)纯函数忠实移植测试：对应 GLSL uBleach 分支
// l = Rec709 亮度; bch = mix(c, luma, 0.5); c = mix(c, bch, t) → 电影银盐半去饱和质感
function applyBleach(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const bch = [c[0] + (l - c[0]) * 0.5, c[1] + (l - c[1]) * 0.5, c[2] + (l - c[2]) * 0.5];
  return [c[0] + (bch[0] - c[0]) * t, c[1] + (bch[1] - c[1]) * t, c[2] + (bch[2] - c[2]) * t];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-9)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);
const rng = c => Math.max(...c) - Math.min(...c);

// t=0 恒等
ok('t=0 恒等', eq3(applyBleach([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// t=1 半去饱和(luma 混合 0.5)
ok('t=1 [0.2,0.5,0.8] => [0.32894,0.47894,0.62894]', eq3(applyBleach([0.2,0.5,0.8], 1), [0.32894,0.47894,0.62894]));
// t=0.5 半插值 = (c+bch)/2
ok('t=0.5 [0.2,0.5,0.8] => [0.26447,0.48947,0.71447]', eq3(applyBleach([0.2,0.5,0.8], 0.5), [0.26447,0.48947,0.71447]));
// t=1 纯红 → 向亮度 0.2126 半去饱和
ok('t=1 纯红 [1,0,0] => [0.6063,0.1063,0.1063]', eq3(applyBleach([1,0,0], 1), [0.6063,0.1063,0.1063]));
// 降饱和：t=1 后通道极差变小(更灰)
ok('t=1 降低饱和度(通道极差缩小)', rng(applyBleach([0.2,0.5,0.8], 1)) < rng([0.2,0.5,0.8]));
// 单调：t 越大越接近 bch
ok('t 越大越接近半去饱和', rng(applyBleach([0.2,0.5,0.8], 0.8)) < rng(applyBleach([0.2,0.5,0.8], 0.2)));
// 钳制
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applyBleach(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uBleach uniform', /uniform float uBleach;/.test(src));
ok('main.js 含 uBleach GLSL 分支', /if\(uBleach > 0\.0\)\{/.test(src));
ok('main.js 绑定 uBleach uniform', /gl\.uniform1f\(u\(showProg,'uBleach'\), bleach\);/.test(src));
ok('presetToParams 含 bleach', /bleach: num\(p\.bleach, 0\)/.test(src));
ok('index.html 含 bleach 滑块', /id="bleach"/.test(html));
ok('index.html 含 bleachVal 显示', /id="bleachVal"/.test(html));

console.log(`\n[Lumen bleach] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
