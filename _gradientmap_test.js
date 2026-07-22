// Lumen 渐变映射(Gradient-map)纯函数忠实移植测试：对应 GLSL uGradientmap + gradientMap()
// 按亮度 l 做日落渐变(深蓝→绯红→金黄)，再按强度 mix 到原图。
function gradientMap(l){
  l = Math.min(1, Math.max(0, l));
  const s0 = [0.10, 0.16, 0.42];   // 阴影：深蓝
  const s1 = [0.70, 0.12, 0.12];   // 中间：绯红
  const s2 = [0.99, 0.73, 0.18];   // 高光：金黄
  if(l < 0.5) return [s0[0]+(s1[0]-s0[0])*(l/0.5), s0[1]+(s1[1]-s0[1])*(l/0.5), s0[2]+(s1[2]-s0[2])*(l/0.5)];
  const u = (l - 0.5) / 0.5;
  return [s1[0]+(s2[0]-s1[0])*u, s1[1]+(s2[1]-s1[1])*u, s1[2]+(s2[2]-s1[2])*u];
}
function applyGradientmap(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const gm = gradientMap(l);
  return [c[0]+(gm[0]-c[0])*t, c[1]+(gm[1]-c[1])*t, c[2]+(gm[2]-c[2])*t];
}
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t = (a, b, e=1e-4)=> Math.abs(a-b) <= e;
const eq3 = (a, b)=> t(a[0],b[0]) && t(a[1],b[1]) && t(a[2],b[2]);

// t=0 恒等
ok('t=0 恒等', eq3(applyGradientmap([0.2,0.5,0.8], 0), [0.2,0.5,0.8]));
// 纯黑 l=0 => 渐变阴影深蓝(0.10,0.16,0.42)
ok('纯黑 t=1 => 阴影深蓝', eq3(applyGradientmap([0,0,0], 1), [0.10,0.16,0.42]));
// 阴影段蓝通道最高
ok('纯黑 t=1 蓝通道最高(深蓝)', (()=>{ const r = applyGradientmap([0,0,0], 1); return r[2] > r[0] && r[2] > r[1]; })());
// 中灰 l=0.5 => 绯红(0.70,0.12,0.12)：红最高，绿蓝低且相近
ok('中灰 l=0.5 => 绯红(红最高)', (()=>{ const r = gradientMap(0.5); return t(r[0],0.70) && t(r[1],0.12) && t(r[2],0.12) && r[0] > r[1]; })());
// 纯白 l=1 => 金黄(0.99,0.73,0.18)：红最高、绿中、蓝最低
ok('纯白 t=1 => 金黄(红最高蓝最低)', (()=>{ const r = applyGradientmap([1,1,1], 1); return r[0] > r[1] && r[1] > r[2]; })());
// 暗灰 l≈0.2 => 介于深蓝与绯红之间，蓝>绿
ok('暗灰 t=1 蓝>绿', (()=>{ const r = applyGradientmap([0.2,0.2,0.2], 1); return r[2] > r[1]; })());
// 亮灰 l≈0.8 => 介于绯红与金黄之间，红仍最高
ok('亮灰 t=1 红最高', (()=>{ const r = applyGradientmap([0.8,0.8,0.8], 1); return r[0] >= r[1] && r[0] >= r[2]; })());
// 渐变连续：l=0.5 为 s1，l=0.25 介于 s0/s1 之间（蓝<0.42 且 >0.12）
ok('渐变中段连续(0.25 蓝介于深蓝/绯红间)', (()=>{ const r = gradientMap(0.25); return r[2] < 0.42 && r[2] > 0.12; })());
// 单调：t 越大，中灰偏离原色越多
ok('效果随 t 单调增强', (()=>{
  const base=[0.5,0.5,0.5];
  const d = (v)=> Math.abs(v[0]-0.5)+Math.abs(v[1]-0.5)+Math.abs(v[2]-0.5);
  return d(applyGradientmap(base,1)) > d(applyGradientmap(base,0.5));
})());
// 渐变输出在 [0,1]
ok('渐变输出在[0,1]', (()=>{ const r = applyGradientmap([1,0,0.5], 1); return r.every(v => v>=0 && v<=1); })());
// 输入越界 clamp
ok('l<0 与 l>1 被 clamp', (()=>{
  const a = gradientMap(-0.5), b = gradientMap(1.7);
  return eq3(a, [0.10,0.16,0.42]) && eq3(b, [0.99,0.73,0.18]);
})());

// ---- 接线检查 ----
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/main.js', 'utf8');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
ok('main.js 声明 uGradientmap uniform', /uniform float uGradientmap;/.test(src));
ok('main.js 含 uGradientmap GLSL 分支', /if\(uGradientmap > 0\.0\)\{/.test(src));
ok('main.js 定义 gradientMap GLSL 函数', /vec3 gradientMap\(float l\)\{/.test(src));
ok('main.js 绑定 uGradientmap uniform', /gl\.uniform1f\(u\(showProg,'uGradientmap'\), gradientmap\);/.test(src));
ok('presetToParams 含 gradientmap (p.)', /gradientmap: num\(p\.gradientmap, 0\)/.test(src));
ok('serializeScene 含 gradientmap', /gradientmap: num\('gradientmap', 0\)/.test(src));
ok('state 默认 gradientmap=0', /, gradientmap=0[,;]/.test(src));
ok('applyPreset 赋值 gradientmap', /gradientmap=s\.gradientmap;/.test(src));
ok('index.html 含 gradientmap 滑块', /id="gradientmap"/.test(html));
ok('index.html 含 gradientmapVal 显示', /id="gradientmapVal"/.test(html));

console.log(`\n[Lumen gradientmap] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
