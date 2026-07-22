// Lumen 漩涡色相(Swirl)纯函数忠实移植测试：对应 GLSL uSwirl
// 色相随半径渐进旋转（漩涡/扭曲感），再按强度 mix 到原图。
function rgb2hsv(c){
  const r=c[0], g=c[1], b=c[2];
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d>1e-10){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h/=6; if(h<0) h+=1;
  }
  const s = max<=1e-10?0:d/max;
  return [h, s, max];
}
function hsv2rgb(c){
  const h=c[0], s=c[1], v=c[2];
  const i=Math.floor(h*6), f=h*6-i;
  const p=v*(1-s), q=v*(1-f*s), t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){
    case 0: r=v;g=t;b=p;break; case 1: r=q;g=v;b=p;break;
    case 2: r=p;g=v;b=t;break; case 3: r=p;g=q;b=v;break;
    case 4: r=t;g=p;b=v;break; case 5: r=v;g=p;b=q;break;
  }
  return [r,g,b];
}
function hueShiftJS(c, deg){
  const cc=[Math.max(0,Math.min(1,c[0])),Math.max(0,Math.min(1,c[1])),Math.max(0,Math.min(1,c[2]))];
  const hsv=rgb2hsv(cc);
  hsv[0]=((hsv[0]+deg/360)%1+1)%1;
  return hsv2rgb(hsv).map(v=>Math.max(0,Math.min(1,v)));
}
function applySwirl(c, uv, t){
  if(t <= 0) return [c[0], c[1], c[2]];
  const dx=uv[0]-0.5, dy=uv[1]-0.5;
  const radius=Math.sqrt(dx*dx + dy*dy);
  const deg=Math.pow(radius, 1.5)*1080.0*t;
  const shifted=hueShiftJS(c, deg);
  const mix=(a,b,f)=>a+(b-a)*f;
  return [mix(c[0],shifted[0],t), mix(c[1],shifted[1],t), mix(c[2],shifted[2],t)];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);
const mix=(a,b,f)=>a+(b-a)*f;

const c=[0.2,0.5,0.8];
ok('t=0 恒等', eq3(applySwirl(c,[0.3,0.7],0), c));
ok('画面中心(0.5,0.5)半径=0 → 无色相偏移', eq3(applySwirl(c,[0.5,0.5],1), c));
{
  const uv=[0,0]; const dx=uv[0]-0.5, dy=uv[1]-0.5;
  const radius=Math.sqrt(dx*dx+dy*dy);
  const deg=Math.pow(radius,1.5)*1080.0*1;
  const shifted=hueShiftJS(c, deg);
  ok('角点发生色相旋转(结果≠原色)', !eq3(applySwirl(c,uv,1), c));
  ok('t=1 时结果=shifted(完全旋转)', eq3(applySwirl(c,uv,1), shifted));
  ok('t=1 数值精确: mix(c,shifted,1)', eq3(applySwirl(c,uv,1), [mix(c[0],shifted[0],1),mix(c[1],shifted[1],1),mix(c[2],shifted[2],1)]));
}
{
  const uv=[0.1,0.9];
  const d1=Math.sqrt((0.1-0.5)**2+(0.9-0.5)**2);
  const d2=Math.sqrt((0.5-0.5)**2+(0.5-0.5)**2);
  const shifted1=hueShiftJS(c, Math.pow(d1,1.5)*1080*0.5);
  const shifted2=hueShiftJS(c, Math.pow(d2,1.5)*1080*0.5);
  const r1=applySwirl(c,uv,0.5), r2=applySwirl(c,[0.5,0.5],0.5);
  const dist=v=>Math.abs(v[0]-c[0])+Math.abs(v[1]-c[1])+Math.abs(v[2]-c[2]);
  ok('离中心越远色相偏移越大(t=0.5)', dist(r1) > dist(r2));
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(let x=0;x<=4;x++) for(let y=0;y<=4;y++){
    const o=applySwirl([x/4,y/4,0.5],[x/4,y/4],tt);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uSwirl uniform', /uniform float uSwirl;/.test(src));
ok('main.js 含 uSwirl GLSL 分支', /if\(uSwirl > 0\.0\)\{/.test(src));
ok('main.js 绑定 uSwirl uniform', /gl\.uniform1f\(u\(showProg,'uSwirl'\), swirl\);/.test(src));
ok('presetToParams 含 swirl (p.)', /swirl: num\(p\.swirl, 0\)/.test(src));
ok('serializeScene 含 swirl', /swirl: num\('swirl', 0\)/.test(src));
ok('state 默认 swirl=0', /swirl=0[,;]/.test(src));
ok('applyPreset 赋值 swirl', /swirl=s\.swirl;/.test(src));
ok('index.html 含 swirl 滑块', /id="swirl"/.test(html));
ok('index.html 含 swirlVal 显示', /id="swirlVal"/.test(html));

console.log(`\n[Lumen swirl] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
