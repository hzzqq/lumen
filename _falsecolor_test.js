// Lumen 伪彩映射(False-color)纯函数忠实移植测试：对应 GLSL uFalsecolor + falseColor()
// 按亮度 l 做 ironbow 热成像伪彩（5 段线性插值），再按强度 mix 到原图。
function falseColor(l){
  l = Math.min(1, Math.max(0, l));
  const stops = [[0,0,0,0],[0.25,0.25,0,0.45],[0.5,0.85,0.10,0.20],[0.75,1.0,0.55,0.05],[1.0,1.0,1.0,0.95]];
  for(let i=0;i<stops.length-1;i++){
    const a = stops[i], b = stops[i+1];
    if(l <= b[0] || i === stops.length-2){
      const t = (l - a[0]) / (b[0] - a[0]);
      return [a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t];
    }
  }
  return [1,1,1];
}
function applyFalsecolor(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const fc = falseColor(l);
  return [c[0]+(fc[0]-c[0])*t, c[1]+(fc[1]-c[1])*t, c[2]+(fc[2]-c[2])*t];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyFalsecolor([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 端点伪彩：纯黑 l=0 => 伪彩黑(0,0,0)，原图黑 mix 后仍黑
ok('纯黑 t=1 => 伪彩黑', eq3(applyFalsecolor([0,0,0], 1), [0,0,0]));
// 纯白 l=1 => 伪彩(1,1,0.95)，t=1 全伪彩
ok('纯白 t=1 => 伪彩近白', eq3(applyFalsecolor([1,1,1], 1), [1,1,0.95]));
// 暗灰 l≈0.2 => 偏紫蓝段（蓝通道 > 绿通道，介于黑与紫之间）
ok('暗灰 t=1 伪彩蓝>红', (()=>{ const r = applyFalsecolor([0.2,0.2,0.2], 1); return r[2] > r[0]; })());
// 中灰 l≈0.5 => 偏红段（红通道最高）
ok('中灰 t=1 伪彩红最高', (()=>{ const r = applyFalsecolor([0.5,0.5,0.5], 1); return r[0] >= r[1] && r[0] >= r[2]; })());
// 亮灰 l≈0.8 => 偏橙黄段（红、绿高，蓝低）
ok('亮灰 t=1 伪彩红绿高蓝低', (()=>{ const r = applyFalsecolor([0.8,0.8,0.8], 1); return r[0] > r[2] && r[1] > r[2]; })());
// 单调：t 越大，中灰偏离原色越多（与原始灰度差增大）
ok('效果随 t 单调增强', (()=>{
  const base=[0.5,0.5,0.5];
  const d = (v)=> Math.abs(v[0]-0.5)+Math.abs(v[1]-0.5)+Math.abs(v[2]-0.5);
  return d(applyFalsecolor(base,1)) > d(applyFalsecolor(base,0.5));
})());
// 伪彩输出在 [0,1]
ok('伪彩输出在[0,1]', (()=>{ const r = applyFalsecolor([1,0,0.5], 1); return r.every(v => v>=0 && v<=1); })());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uFalsecolor uniform', /uniform float uFalsecolor;/.test(src));
ok('main.js 含 uFalsecolor GLSL 分支', /if\(uFalsecolor > 0\.0\)\{/.test(src));
ok('main.js 定义 falseColor GLSL 函数', /vec3 falseColor\(float l\)\{/.test(src));
ok('main.js 绑定 uFalsecolor uniform', /gl\.uniform1f\(u\(showProg,'uFalsecolor'\), falsecolor\);/.test(src));
ok('presetToParams 含 falsecolor (p.)', /falsecolor: num\(p\.falsecolor, 0\)/.test(src));
ok('serializeScene 含 falsecolor', /falsecolor: num\('falsecolor', 0\)/.test(src));
ok('state 默认 falsecolor=0', /, falsecolor=0[,;]/.test(src));
ok('applyPreset 赋值 falsecolor', /falsecolor=s\.falsecolor;/.test(src));
ok('index.html 含 falsecolor 滑块', /id="falsecolor"/.test(html));
ok('index.html 含 falsecolorVal 显示', /id="falsecolorVal"/.test(html));

console.log(`\n[Lumen falsecolor] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
