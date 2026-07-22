// Lumen 像素化(Pixelate/Mosaic)纯函数忠实移植测试：对应 GLSL uPixelate
// 把 UV 量子化到方块，重采样得到马赛克（此处 sampleHDR 为可注入的确定性采样器）。
function aces(x){ const a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; const v=(x*(a*x+b))/(x*(c*x+d)+e); return Math.max(0,Math.min(1,v)); }
function tonemapJS(x, m){
  const f=(v)=>{
    if(m===1) return Math.max(0,Math.min(1, v/(1+v)));
    if(m===2) return Math.max(0,Math.min(1, v));
    if(m===3){ const A=0.15,B=0.50,C=0.10,D=0.20,E=0.02,F=0.30; return Math.max(0,Math.min(1, ((v*(A*v+C*B)+D*E)/(v*(A*v+B)+D*F)) - E/F)); }
    return aces(v);
  };
  return [f(x[0]), f(x[1]), f(x[2])];
}
function applyPixelate(c, uv, t, sampleHDR, exposure, tone){
  if(t <= 0) return [c[0], c[1], c[2]];
  const cells = 160.0 + (8.0 - 160.0) * t;          // mix(160.0, 8.0, t)
  const cellx = (Math.floor(uv[0]*cells) + 0.5) / cells;
  const celly = (Math.floor(uv[1]*cells) + 0.5) / cells;
  const src = sampleHDR([cellx, celly]);
  const pc = tonemapJS([src[0]*exposure, src[1]*exposure, src[2]*exposure], tone);
  const mix=(a,b,f)=>a+(b-a)*f;
  return [mix(c[0],pc[0],t), mix(c[1],pc[1],t), mix(c[2],pc[2],t)];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);

const c=[0.2,0.5,0.8], exposure=1, tone=0;
ok('t=0 恒等', eq3(applyPixelate(c,[0.3,0.7],0, (u)=>[u[0],u[1],0.42], exposure, tone), c));
{
  // 验证方块中心量化(cell center)公式
  const uv=[0.3,0.7], tt=1;
  const cells=160.0+(8.0-160.0)*tt;
  const cellx=(Math.floor(uv[0]*cells)+0.5)/cells;
  const celly=(Math.floor(uv[1]*cells)+0.5)/cells;
  let lastCell=null;
  const sampleHDR=(u)=>{ lastCell=u; return [u[0],u[1],0.42]; };
  applyPixelate(c, uv, tt, sampleHDR, exposure, tone);
  ok('重采样坐标=方块中心(cell)', t(lastCell[0],cellx) && t(lastCell[1],celly));
  ok('t=1 方块中心在[0,1]', lastCell[0]>=0 && lastCell[0]<=1 && lastCell[1]>=0 && lastCell[1]<=1);
}
{
  // t=1 时结果完全等于 tonemap(src*exposure)
  const uv=[0.3,0.7], tt=1;
  const cells=160.0+(8.0-160.0)*tt;
  const cellx=(Math.floor(uv[0]*cells)+0.5)/cells, celly=(Math.floor(uv[1]*cells)+0.5)/cells;
  const sampleHDR=(u)=>[u[0],u[1],0.42];
  const src=sampleHDR([cellx,celly]);
  const pc=tonemapJS([src[0]*exposure,src[1]*exposure,src[2]*exposure],tone);
  ok('t=1 结果=tonemap(src*exposure)', eq3(applyPixelate(c,uv,tt,sampleHDR,exposure,tone), pc));
}
{
  // 同一方块内不同 uv → 重采样到同一 cell（马赛克一致性）
  const sampleHDR=(u)=>[u[0],u[1],0.42];
  const cells=160.0+(8.0-160.0)*1;
  const c1=(Math.floor(0.31*cells)+0.5)/cells, c2=(Math.floor(0.33*cells)+0.5)/cells;
  ok('同块内 uv 量化到同一 cell', t(c1,c2));
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(let x=0;x<=4;x++) for(let y=0;y<=4;y++){
    const sampleHDR=(u)=>[u[0]*0.5,u[1]*0.5,0.42];
    const o=applyPixelate([x/4,y/4,0.5],[x/4,y/4],tt,sampleHDR,exposure,tone);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uPixelate uniform', /uniform float uPixelate;/.test(src));
ok('main.js 含 uPixelate GLSL 分支', /if\(uPixelate > 0\.0\)\{/.test(src));
ok('main.js 绑定 uPixelate uniform', /gl\.uniform1f\(u\(showProg,'uPixelate'\), pixelate\);/.test(src));
ok('presetToParams 含 pixelate (p.)', /pixelate: num\(p\.pixelate, 0\)/.test(src));
ok('serializeScene 含 pixelate', /pixelate: num\('pixelate', 0\)/.test(src));
ok('state 默认 pixelate=0', /pixelate=0[,;]/.test(src));
ok('applyPreset 赋值 pixelate', /pixelate=s\.pixelate;/.test(src));
ok('index.html 含 pixelate 滑块', /id="pixelate"/.test(html));
ok('index.html 含 pixelateVal 显示', /id="pixelateVal"/.test(html));

console.log(`\n[Lumen pixelate] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
