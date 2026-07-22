// Lumen 分离色调(Split-tone)纯函数忠实移植：对应 GLSL uSplitTone 分支
// tint = mix(shadowTint=(0.90,0.95,1.10), highTint=(1.10,0.95,0.85), l)；c = clamp(mix(c, c*tint, t))
function applySplit(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const tr = 0.90 + (1.10 - 0.90) * l;
  const tg = 0.95 + (0.95 - 0.95) * l;
  const tb = 1.10 + (0.85 - 1.10) * l;
  const clamp = x => Math.max(0, Math.min(1, x));
  return [ clamp(c[0] + (c[0]*tr - c[0]) * t),
           clamp(c[1] + (c[1]*tg - c[1]) * t),
           clamp(c[2] + (c[2]*tb - c[2]) * t) ];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> near(a[0],b[0]) && near(a[1],b[1]) && near(a[2],b[2]);
const rng = c => Math.max(...c) - Math.min(...c);

// t=0 恒等
ok('t=0 恒等', eq3(applySplit([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// t=1 数值
ok('t=1 [0.2,0.5,0.8] => [0.19832,0.475,0.78842]', eq3(applySplit([0.2,0.5,0.8], 1), [0.19832,0.475,0.78842]));
// t=0.5 半插值
ok('t=0.5 [0.2,0.5,0.8] => [0.19916,0.4875,0.79421]', eq3(applySplit([0.2,0.5,0.8], 0.5), [0.19916,0.4875,0.79421]));
// 阴影染冷(蓝增益)：暗部 t=1 后蓝色相对提升(纯蓝通道 [0,0,0.8])
ok('暗部蓝色被抬升(冷调)', applySplit([0,0,0.8], 1)[2] > 0.8);
// 钳制
{
  let allIn = true;
  for(const c of [[0,0,0],[1,1,1],[0.3,0.7,0.2],[0.9,0.1,0.5]]) for(const t of [0,0.25,0.5,0.75,1])
    for(const v of applySplit(c,t)) if(v < -1e-9 || v > 1+1e-9) allIn = false;
  ok('任意输入/强度输出均在 [0,1]', allIn);
}

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uSplitTone uniform', /uniform float uSplitTone;/.test(src));
ok('main.js 含 uSplitTone GLSL 分支', /if\(uSplitTone > 0\.0\)\{/.test(src));
ok('main.js 绑定 uSplitTone uniform', /gl\.uniform1f\(u\(showProg,'uSplitTone'\), splittone\);/.test(src));
ok('presetToParams 含 splittone', /splittone: num\(p\.splittone, 0\)/.test(src));
ok('index.html 含 splittone 滑块', /id="splittone"/.test(html));
ok('index.html 含 splittoneVal 显示', /id="splittoneVal"/.test(html));

console.log(`\n[Lumen split-tone] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
