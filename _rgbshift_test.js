// Lumen RGB 偏移/色散(RGB Shift)纯函数忠实移植测试：对应 GLSL uRgbshift
// R/B 通道水平错位（色散），G 通道以当前值为基准，再按强度 mix 到原图。
function applyRgbshift(c, uv, t, sampleHDR){
  if(t <= 0) return [c[0], c[1], c[2]];
  const amt = t * 0.05;
  const r = sampleHDR([uv[0] - amt, uv[1]]);
  const b = sampleHDR([uv[0] + amt, uv[1]]);
  const shifted = [r[0], c[1], b[2]];
  const mix=(a,b,f)=>a+(b-a)*f;
  return [mix(c[0],shifted[0],t), mix(c[1],shifted[1],t), mix(c[2],shifted[2],t)];
}
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const t=(a,b,e=1e-4)=>Math.abs(a-b)<=e;
const eq3=(a,b)=>t(a[0],b[0])&&t(a[1],b[1])&&t(a[2],b[2]);

// 确定性采样：返回 [uv.x, uv.y, 0.42]（并按 CLAMP_TO_EDGE 钳制到[0,1]）
function sampleHDR(uv){ const x=Math.max(0,Math.min(1,uv[0])), y=Math.max(0,Math.min(1,uv[1])); return [x, y, 0.42]; }

const c=[0.2,0.5,0.8];
ok('t=0 恒等', eq3(applyRgbshift(c,[0.3,0.7],0,sampleHDR), c));
{
  const uv=[0.9,0.3], tt=0.5;
  const amt=tt*0.05;
  const r=sampleHDR([uv[0]-amt,uv[1]]);
  const b=sampleHDR([uv[0]+amt,uv[1]]);
  const shifted=[r[0], c[1], b[2]];
  const out=applyRgbshift(c,uv,tt,sampleHDR);
  const mix=(a,b,f)=>a+(b-a)*f;
  ok('t 时结果=mix(c,shifted,t)', eq3(out,[mix(c[0],shifted[0],tt),mix(c[1],shifted[1],tt),mix(c[2],shifted[2],tt)]));
  ok('R 取自 uv.x-amt', t(r[0], uv[0]-amt) && t(r[1], uv[1]));
  ok('B 取自 uv.x+amt', t(b[0], uv[0]+amt) && t(b[1], uv[1]));
  ok('G 取自基准 c.g', t(shifted[1], c[1]));
}
{
  const uv=[0.9,0.3], tt=1;
  const amt=tt*0.05;
  const r=sampleHDR([uv[0]-amt,uv[1]]);
  const b=sampleHDR([uv[0]+amt,uv[1]]);
  const shifted=[r[0], c[1], b[2]];
  ok('t=1 结果=shifted(完全偏移)', eq3(applyRgbshift(c,uv,tt,sampleHDR), shifted));
}
{
  // 偏移量随强度线性缩放：t 越大，R 通道采样点越靠左（错位越大）
  const uv=[0.9,0.3];
  const loR=sampleHDR([uv[0]-0.5*0.05, uv[1]])[0];   // 0.875
  const hiR=sampleHDR([uv[0]-1.0*0.05, uv[1]])[0];   // 0.850
  ok('amt 线性: t 越大 R 采样越靠左(偏移翻倍)', hiR < loR);
}
{
  // 方向符号（中心 uv=[0.5,0.5]，amt>0）：R 朝左(uv.x-amt)、B 朝右(uv.x+amt)
  const uv=[0.5,0.5]; const tt=0.5; const amt=tt*0.05;
  const r=sampleHDR([uv[0]-amt,uv[1]]);
  const b=sampleHDR([uv[0]+amt,uv[1]]);
  ok('中心 R 朝左(r.x<uv.x)', r[0] < uv[0]);
  ok('中心 B 朝右(b.x>uv.x)', b[0] > uv[0]);
}
{
  let bounded=true;
  for(const tt of [0,0.3,0.7,1]) for(let x=0;x<=4;x++) for(let y=0;y<=4;y++){
    const o=applyRgbshift([x/4,y/4,0.5],[x/4,y/4],tt,sampleHDR);
    if(!o.every(v=>v>=-1e-6 && v<=1+1e-6)) bounded=false;
  }
  ok('输出各分量有界[0,1]', bounded);
}

// ---- 接线检查 ----
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/main.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
ok('main.js 声明 uRgbshift uniform', /uniform float uRgbshift;/.test(src));
ok('main.js 含 uRgbshift GLSL 分支', /if\(uRgbshift > 0\.0\)\{/.test(src));
ok('main.js 绑定 uRgbshift uniform', /gl\.uniform1f\(u\(showProg,'uRgbshift'\), rgbshift\);/.test(src));
ok('presetToParams 含 rgbshift (p.)', /rgbshift: num\(p\.rgbshift, 0\)/.test(src));
ok('serializeScene 含 rgbshift', /rgbshift: num\('rgbshift', 0\)/.test(src));
ok('state 默认 rgbshift=0', /rgbshift=0[,;]/.test(src));
ok('applyPreset 赋值 rgbshift', /rgbshift=s\.rgbshift;/.test(src));
ok('index.html 含 rgbshift 滑块', /id="rgbshift"/.test(html));
ok('index.html 含 rgbshiftVal 显示', /id="rgbshiftVal"/.test(html));

console.log(`\n[Lumen rgbshift] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
