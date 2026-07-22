// Lumen 夜视绿(Night Vision)纯函数忠实移植测试：对应 GLSL uNight
// 去色转绿单色 + 轻微提亮/对比，再按强度 mix 到原图。
function applyNight(c, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const clamp=(v)=>Math.max(0, Math.min(1, v));
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const r = clamp(l * 0.15 * (1.0 + 0.5*t) + 0.02);
  const g = clamp(l *        (1.0 + 0.5*t) + 0.02);
  const b = clamp(l * 0.25 * (1.0 + 0.5*t) + 0.02);
  return [c[0]+(r-c[0])*t, c[1]+(g-c[1])*t, c[2]+(b-c[2])*t];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);
const clamp=(v)=>Math.max(0,Math.min(1,v));

ok('t=0 恒等', eq3(applyNight([0.2,0.5,0.8],0), [0.2,0.5,0.8]));
{
  const c=[0.5,0.5,0.5]; const tt=1;
  const l=0.299*c[0]+0.587*c[1]+0.114*c[2];
  const r=clamp(l*0.15*1.5+0.02), g=clamp(l*1.5+0.02), b=clamp(l*0.25*1.5+0.02);
  const out=applyNight(c,tt);
  ok('t=1 结果=绿单色 nv', eq3(out,[r,g,b]));
  ok('t=1 绿通道最高(夜视绿)', out[1] >= out[0] && out[1] >= out[2]);
}
{
  const c=[0.9,0.2,0.3]; const tt=1;
  const l=0.299*c[0]+0.587*c[1]+0.114*c[2];
  const r=clamp(l*0.15*1.5+0.02), g=clamp(l*1.5+0.02), b=clamp(l*0.25*1.5+0.02);
  const out=applyNight(c,tt);
  ok('任意色 t=1 绿通道主导', out[1] >= out[0] && out[1] >= out[2]);
  ok('t=1 数值精确', eq3(out,[r,g,b]));
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(let x=0;x<=4;x++) for(let y=0;y<=4;y++){
    const o=applyNight([x/4,y/4,(x+y)/8],tt);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}
{
  const base=[0.8,0.3,0.1]; const d=v=>Math.abs(v[0]-base[0])+Math.abs(v[1]-base[1])+Math.abs(v[2]-base[2]);
  ok('效果随 t 单调增强', d(applyNight(base,1)) > d(applyNight(base,0.5)));
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uNight uniform', /uniform float uNight;/.test(src));
ok('main.js 含 uNight GLSL 分支', /if\(uNight > 0\.0\)\{/.test(src));
ok('main.js 绑定 uNight uniform', /gl\.uniform1f\(u\(showProg,'uNight'\), night\);/.test(src));
ok('presetToParams 含 night (p.)', /night: num\(p\.night, 0\)/.test(src));
ok('serializeScene 含 night', /night: num\('night', 0\)/.test(src));
ok('state 默认 night=0', /night=0[,;]/.test(src));
ok('applyPreset 赋值 night', /night=s\.night;/.test(src));
ok('index.html 含 night 滑块', /id="night"/.test(html));
ok('index.html 含 nightVal 显示', /id="nightVal"/.test(html));

console.log(`\n[Lumen night] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
