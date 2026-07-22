// Lumen 浮雕(Emboss)纯函数忠实移植测试：对应 GLSL uEmboss
// 用 dFdx/dFdy 导数做方向性浮雕（此处 dx,dy 为亮度 luma 的屏幕空间导数），
// 再按强度 mix 到原图。
function applyEmboss(c, dx, dy, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const clamp=(v)=>Math.max(0, Math.min(1, v));
  const e = (dx + dy) * t * 4.0;
  const r = clamp(0.5 + e), g = clamp(0.5 + e), b = clamp(0.5 + e);
  return [c[0]+(r-c[0])*t, c[1]+(g-c[1])*t, c[2]+(b-c[2])*t];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);
const clamp=(v)=>Math.max(0,Math.min(1,v));

const c=[0.2,0.5,0.8];
ok('t=0 恒等', eq3(applyEmboss(c,0.01,0.02,0), c));
{
  const dx=0.05, dy=0.03, tt=1;
  const e=(dx+dy)*tt*4.0;
  const r=clamp(0.5+e), g=clamp(0.5+e), b=clamp(0.5+e);
  const out=applyEmboss(c,dx,dy,tt);
  ok('t=1 结果为灰阶浮雕(等亮)', eq3(out,[r,g,b]) && t(out[0],out[1]) && t(out[1],out[2]));
  ok('t=1 数值精确 = clamp(0.5+e)', eq3(out,[r,g,b]));
}
{
  const out=applyEmboss(c,0.05,0.03,1);
  ok('正梯度 → 亮于中灰0.5', out[0] > 0.5);
}
{
  const out=applyEmboss(c,-0.05,-0.03,1);
  ok('负梯度 → 暗于中灰0.5', out[0] < 0.5);
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(const dx of [-0.1,0,0.1]) for(const dy of [-0.1,0,0.1]){
    const o=applyEmboss(c,dx,dy,tt);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}
{
  const outHi=applyEmboss(c,0.05,0.05,1)[0];   // e=(0.1)*4=0.4 → 0.9
  const outLo=applyEmboss(c,0.01,0.01,1)[0];   // e=(0.02)*4=0.08 → 0.58
  ok('浮雕亮度随梯度幅值单调增强', outHi > outLo);
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uEmboss uniform', /uniform float uEmboss;/.test(src));
ok('main.js 含 uEmboss GLSL 分支', /if\(uEmboss > 0\.0\)\{/.test(src));
ok('main.js 绑定 uEmboss uniform', /gl\.uniform1f\(u\(showProg,'uEmboss'\), emboss\);/.test(src));
ok('presetToParams 含 emboss (p.)', /emboss: num\(p\.emboss, 0\)/.test(src));
ok('serializeScene 含 emboss', /emboss: num\('emboss', 0\)/.test(src));
ok('state 默认 emboss=0', /emboss=0[,;]/.test(src));
ok('applyPreset 赋值 emboss', /emboss=s\.emboss;/.test(src));
ok('index.html 含 emboss 滑块', /id="emboss"/.test(html));
ok('index.html 含 embossVal 显示', /id="embossVal"/.test(html));

console.log(`\n[Lumen emboss] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
