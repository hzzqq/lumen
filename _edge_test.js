// Lumen 边缘检测(Edge Detect)纯函数忠实移植测试：对应 GLSL uEdge
// 用 dFdx/dFdy 计算亮度梯度幅值做边缘（此处 dx,dy 为亮度 luma 的屏幕空间导数），
// 再按强度 mix 到原图。
function applyEdge(c, dx, dy, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const clamp=(v)=>Math.max(0, Math.min(1, v));
  const mag = Math.sqrt(dx*dx + dy*dy);
  const e = mag * t * 8.0;
  const v = clamp(e);
  return [c[0]+(v-c[0])*t, c[1]+(v-c[1])*t, c[2]+(v-c[2])*t];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);
const clamp=(v)=>Math.max(0,Math.min(1,v));

const c=[0.2,0.5,0.8];
ok('t=0 恒等', eq3(applyEdge(c,0.01,0.02,0), c));
{
  const dx=0.05, dy=0.03, tt=1;
  const mag=Math.sqrt(dx*dx+dy*dy);
  const v=clamp(mag*tt*8.0);
  const out=applyEdge(c,dx,dy,tt);
  ok('t=1 结果为灰阶边缘(等亮)', eq3(out,[v,v,v]) && t(out[0],out[1]) && t(out[1],out[2]));
  ok('t=1 数值精确 = clamp(mag*8)', eq3(out,[v,v,v]));
}
{
  const out=applyEdge(c,0,0,1);
  ok('零梯度(平坦区) → 边缘图全黑(无边缘)', eq3(out, [0,0,0]));
}
{
  const out=applyEdge(c,0.1,0.1,1);
  ok('强梯度 → 高亮边缘(白)', out[0] > 0.5);
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(const dx of [-0.1,0,0.1]) for(const dy of [-0.1,0,0.1]){
    const o=applyEdge(c,dx,dy,tt);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}
{
  const out1=applyEdge(c,0.1,0.1,1), out2=applyEdge(c,0.01,0.01,1);
  ok('边缘强度随梯度幅值单调增强', out1[0] > out2[0]);
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uEdge uniform', /uniform float uEdge;/.test(src));
ok('main.js 含 uEdge GLSL 分支', /if\(uEdge > 0\.0\)\{/.test(src));
ok('main.js 绑定 uEdge uniform', /gl\.uniform1f\(u\(showProg,'uEdge'\), edge\);/.test(src));
ok('presetToParams 含 edge (p.)', /edge: num\(p\.edge, 0\)/.test(src));
ok('serializeScene 含 edge', /edge: num\('edge', 0\)/.test(src));
ok('state 默认 edge=0', /edge=0[,;]/.test(src));
ok('applyPreset 赋值 edge', /edge=s\.edge;/.test(src));
ok('index.html 含 edge 滑块', /id="edge"/.test(html));
ok('index.html 含 edgeVal 显示', /id="edgeVal"/.test(html));

console.log(`\n[Lumen edge] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
