// Lumen 黄金比(R2 低差异二维序列)渐进采样：纯函数移植 + 源接线校验。
// 验证：逐帧偏移序列低差异、落在像素内、确定性、与 uJitter 强度乘积、以及 source 接线。
const fs = require('fs');
const path = require('path');
const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const { execSync } = require('child_process');

const dir = path.join(__dirname);
let fail = 0, pass = 0;
const ok = (n, c)=> c ? pass++ : (fail++, console.log('  FAIL', n));

// ---- 纯函数移植（对应 GLSL 逻辑）----
const A1 = 0.7548776662, A2 = 0.5698402909;
function fract(x){ return x - Math.floor(x); }
function r2seq(frame){ const f = frame + 1; return [fract(A1*f), fract(A2*f)]; }
// 主射线像素内偏移（uv 空间叠加），res 为缓冲分辨率
function jitterOffset(resW, resH, frame, strength){
  const [r1, r2] = r2seq(frame);
  const jp = [r1 - 0.5, r2 - 0.5].map(v=> v * strength);
  return [jp[0] * (2.0/resW), jp[1] * (2.0/resH)];
}

// 1) 序列确定性 & 低差异（相邻帧不重复，0..1 内）
let prev = null, allInUnit = true, distinct = new Set();
for(let f=0; f<256; f++){
  const s = r2seq(f);
  if(s[0] < 0 || s[0] >= 1 || s[1] < 0 || s[1] >= 1) allInUnit = false;
  distinct.add(s[0].toFixed(4) + ',' + s[1].toFixed(4));
  if(prev){ ok('帧'+f+' 与上一帧不同', !(s[0]===prev[0] && s[1]===prev[1])); }
  prev = s;
}
ok('R2 序列恒在 [0,1)', allInUnit);
ok('256 帧低差异：绝大多数位置唯一', distinct.size > 250);

// 2) strength=0 → 零偏移（关闭）
const z = jitterOffset(800, 600, 10, 0.0);
ok('strength=0 不产生偏移', z[0] === 0 && z[1] === 0);

// 3) strength=1 → 偏移严格落在 [-1/res, 1/res] 像素内
let maxX = 0, maxY = 0;
for(let f=0; f<512; f++){
  const o = jitterOffset(800, 600, f, 1.0);
  maxX = Math.max(maxX, Math.abs(o[0]));
  maxY = Math.max(maxY, Math.abs(o[1]));
}
ok('strength=1 的 x 偏移不超过 ±1 像素(2/resW)', maxX <= 2/800 + 1e-9);
ok('strength=1 的 y 偏移不超过 ±1 像素(2/resH)', maxY <= 2/600 + 1e-9);

// 4) 单调性/缩放：strength 越大偏移越大（同帧比较）
const oS1 = jitterOffset(800, 600, 7, 0.5), oS2 = jitterOffset(800, 600, 7, 1.0);
ok('偏移强度随 strength 等比放大', Math.abs(oS2[0]) > Math.abs(oS1[0]) && Math.abs(oS2[1]) > Math.abs(oS1[1]));

// 5) 序列首帧不等于 (0,0) 也不等于 (0.5,0.5) 中心（保证首帧即有真实抖动，而非落在像素正中）
const f0 = r2seq(0);
ok('首帧不在像素正中心(0.5,0.5)', !(Math.abs(f0[0]-0.5)<1e-9 && Math.abs(f0[1]-0.5)<1e-9));

// ---- 源接线校验 ----
const main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

ok('PT 着色器声明 uJitter', /uniform float uJitter/.test(main));
ok('PT 着色器声明 uFrame', /uniform int\s+uFrame/.test(main));
ok('main() 使用 R2 序列常量', /0\.7548776662/.test(main) && /0\.5698402909/.test(main));
ok('main() 应用抖动到 uv', /uv\.x \+= jp\.x/.test(main) && /uv\.y \+= jp\.y/.test(main));
ok('JS 绑定 uJitter', /gl\.uniform1f\(u\(ptProg,'uJitter'\)/.test(main));
ok('JS 绑定 uFrame', /gl\.uniform1i\(u\(ptProg,'uFrame'\)/.test(main));
ok('serializeScene 含 jitter', /jitter: s\.jitter/.test(main));
ok('deserializeScene 含 jitter', /jitter: num\('jitter', 1\)/.test(main));
ok('applyPreset 含 jitter', /jitter=s\.jitter/.test(main));
ok('exportScene 含 jitter', /rough, jitter,/.test(main) || /jitter, toneMode/.test(main));
ok('UI oninput 绑定 #jitter', /\$\('jitter'\)\.oninput/.test(main));
ok('syncSceneUI 同步 #jitter', /if\(\$\('jitter'\)\)/.test(main));
ok('index.html 滑块 #jitter', /id="jitter"/.test(html));
ok('index.html 显示 jitterVal', /id="jitterVal"/.test(html));

// ---- 语法检查 ESM ----
try { execSync(`"${NODE}" --check --input-type=module < "${path.join(dir,'main.js')}"`, { stdio:'pipe' }); ok('main.js ESM 语法 OK', true); }
catch(e){ ok('main.js ESM 语法 OK', false); console.log(e.stdout?.toString(), e.stderr?.toString()); }

console.log(`\n[Lumen jitter] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
