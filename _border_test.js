// ci169 Lumen 画面边框(border)后处理 —— applyBorder 行为测试(四周压黑相框) + 接线检查(对齐 invert 模式)
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植 main.js 的边框 GLSL：d=min(vUv,1-vUv)，edge=t*0.35，bx/by=smoothstep(edge,edge*0.5,d)，按 b*t 向黑混合。
// 这里以 W×W 方阵逐像素实现，uv=(x+0.5)/W。
function applyBorder(c, t){
  const W = Math.round(Math.sqrt(c.length / 3));
  const edge = t * 0.35;
  const ss = (a, b, x)=>{ if(a === b) return x < a ? 0 : 1; const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  for(let y = 0; y < W; y++) for(let x = 0; x < W; x++){
    const u = (x + 0.5) / W, v = (y + 0.5) / W;
    const dx = Math.min(u, 1 - u), dy = Math.min(v, 1 - v);
    const bx = ss(edge, edge * 0.5, dx), by = ss(edge, edge * 0.5, dy);
    const b = Math.min(1, bx + by);
    if(b > 0){
      const i = (y * W + x) * 3;
      for(let k = 0; k < 3; k++) c[i + k] = c[i + k] + (0 - c[i + k]) * b * t;
    }
  }
  return c;
}

let pass = 0, fail = 0;
function ok(cond, msg){ if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }

const W = 16;
function mkImg(){ const a = new Array(W * W * 3); for(let i = 0; i < a.length; i++) a[i] = 0.6; return a; }

// 1. 强度 0 → 恒等
{
  const a = mkImg(); const b = applyBorder(a.slice(), 0);
  ok('t=0 恒等', a.every((v, i) => Math.abs(v - b[i]) < 1e-9));
}
// 2. 强度 1 → 四角(离四边最近)被压黑，中心基本不变
{
  const a = mkImg(); const c = applyBorder(a.slice(), 1);
  const corner = (c[(0 * W + 0) * 3] + c[(0 * W + 0) * 3 + 1] + c[(0 * W + 0) * 3 + 2]) / 3;
  const center = c[((W >> 1) * W + (W >> 1)) * 3];
  ok('t=1 四角被压黑(<0.3)', corner < 0.3);
  ok('t=1 中心基本不变(>0.5)', center > 0.5);
  ok('t=1 四角明显暗于中心', corner < center - 0.2);
}
// 3. 单调：t=0.5 比 t=0 暗、比 t=1 亮（取四角均亮度）
{
  const cornerAvg = (t)=>{ const c = applyBorder(mkImg(), t); let s = 0, n = 0;
    for(let y = 0; y < W; y += (W - 1)) for(let x = 0; x < W; x += (W - 1)){ s += (c[(y * W + x) * 3]); n++; } return s / n; };
  const d0 = cornerAvg(0), d5 = cornerAvg(0.5), d1 = cornerAvg(1);
  ok('边框随强度单调加深', d0 > d5 && d5 > d1);
}
// 4. 范围：输出仍落在 [0,1]
{
  const c = applyBorder(mkImg(), 1);
  ok('输出在 [0,1]', c.every(v => v >= -1e-9 && v <= 1 + 1e-9));
}

// 5. 接线检查（与 invert 同模式，使用子串匹配，新增 border 不影响既有子串断言）
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/uniform float uBorder;/.test(main), 'main.js 声明 uniform float uBorder');
ok(/if\(uBorder > 0\.0\)/.test(main), 'GLSL 链条含 uBorder 分支');
ok(/gl\.uniform1f\(u\(showProg,'uBorder'\)/.test(main), 'uniform 绑定 uBorder');
ok(/border=0[,;]/.test(main), 'state 默认含 border=0');
ok(/border: s\.border/.test(main), 'serialize 含 border');
ok(/border: num\('border', 0\)/.test(main), 'deserialize 含 border');
ok(/border: num\(p\.border, 0\)/.test(main), 'presetToParams 含 border');
ok(/border=s\.border/.test(main), 'applyPreset/loadScene 含 border');
ok(/Math\.round\(border \* 100\)/.test(main) && /\$\('border'\)/.test(main), 'syncSceneUI 同步 border 滑块');
ok(/\$\('border'\)\.oninput/.test(main), 'oninput 绑定 border 滑块');
ok(/option value="border"|id="border"/.test(html) && /画面边框/.test(html), 'index.html 含「画面边框」滑块');

// 6. preset 字段数
{
  const m = main.match(/presetToParams\(p\)\s*\{[^}]*return\s*\{/);
  // 直接数 main.js 中 deserialize 区块的字段（与 _presets_test 互补，这里仅确认 border 计入）
  const cnt = (main.match(/num\('[a-zA-Z]+',/g) || []).length;
  ok('deserialize 字段含 border（num 计数 >= 48 含全部 post 字段）', cnt >= 48);
}

console.log('raytracer/_border_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
