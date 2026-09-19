// Lumen 太阳软阴影单元测试：GLSL sunCone 锥采样与 sunDirect 软阴影分支不可 Node 烘焙，
// 以结构守护为主（GLSL 关键量 / sunSoftOn 十处接线 / UI / 估计式收敛性注释）；
// JS 侧真函数 sunConeSample 烘焙断言锥缘半角与 GLSL cosMax 常量一致（0.99955 ↔ acos ≈ 0.030 rad），
// 另加 softEstimate 纯数学镜像断言（(Ω/K)·Σ cos 的收敛性与量纲）。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const ihtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name){
  const start = src.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('找不到函数 ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for(; i < src.length; i++){
    const c = src[i];
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return src.slice(start, i+1); }
  }
  throw new Error('函数 ' + name + ' 括号不匹配');
}
const { sunConeSample } = new Function(extractFn('sunConeSample') + '\nreturn { sunConeSample };')();

const COS_MAX = 0.99955;

// ---- 1) JS sunConeSample：锥参数与 GLSL cosMax 常量一致 ----
ok('锥缘半角 = acos(0.99955)（GLSL/JS 常量一致）', (()=>{
  const d = sunConeSample([0,1,0], Math.acos(COS_MAX), 0.0, 1);
  return Math.abs(Math.acos(d[1]) - Math.acos(COS_MAX)) < 1e-9;
})());
ok('锥内样本与轴夹角 ≤ acos(0.99955)', (()=>{
  for(let i = 0; i < 100; i++){
    const d = sunConeSample([0,1,0], Math.acos(COS_MAX), (i*0.618)%1, (i*0.377)%1);
    if(Math.acos(d[1]) > Math.acos(COS_MAX) + 1e-9) return false;
  }
  return true;
})());
// 软阴影估计式镜像：(Ω/K)·Σ dot(n, w_i) —— 全可见时 = Ω·cosβ·E[cosγ] ≈ cosS·Ω
// （E[cosγ]=(1+cosMax)/2，与解析项差 ~2e-4 相对量级，视觉无差）
ok('估计式全可见收敛于 cosS·Ω（1e-3 相对内）', (()=>{
  const omega = 2*Math.PI*(1-COS_MAX), cosS = 0.8;
  const n = [0.6, cosS, 0];   // 法线与轴夹角 cosβ=0.8
  let sum = 0;
  for(let i = 0; i < 20000; i++){
    const d = sunConeSample([0,1,0], Math.acos(COS_MAX), (i*0.6180339887)%1, (i*0.7548776662)%1);
    sum += n[0]*d[0] + n[1]*d[1] + n[2]*d[2];
  }
  const est = omega * (sum/20000);
  const ana = cosS * omega;
  return Math.abs(est - ana) < 1e-3 * ana;
})());

// ---- 2) GLSL 结构守护 ----
ok('GLSL: uSunSoft uniform 声明', src.includes('uniform float uSunSoft;'));
ok('GLSL: sunCone 采样器（cosMax 常量对齐）', /vec3 sunCone\(vec3 axis, float r1, float r2\)\{[\s\S]{0,200}0\.99955/.test(src));
ok('GLSL: 软阴影 K=4 循环', /if\(uSunSoft > 0\.5\)\{[\s\S]{0,400}for\(int k=0;k<4;k\+\+\)\{[\s\S]{0,200}sunCone\(uSunDir, rnd\(\), rnd\(\)\)/.test(src));
ok('GLSL: 可见性估计式 (vis/4.0)', src.includes('albedo * (1.0/PI) * Le * omega * (vis/4.0)'));
ok('GLSL: 硬阴影路径保留', src.includes('albedo * (1.0/PI) * Le * cosS * omega;    // 无遮挡：漫反射太阳直射（硬阴影）'));
ok('GLSL: 焦散分支保留（双折射+高斯斑）', src.includes('float f = ior*sh.rad/(2.0*(ior-1.0));') && src.includes('float gain = exp(-dot(p-F, p-F)/(sigma*sigma));'));
ok('GLSL: 焦散优先于软阴影（不混半影）', src.indexOf('if(sh.mat==2 && sh.rad > 0.0){') < src.indexOf('if(uSunSoft > 0.5){'));

// ---- 3) sunSoftOn 十处接线（默认 false） ----
ok('接线: let 链声明 sunSoftOn=false', /let sceneId=0,[\s\S]{0,400}?sunSoftOn=false,/.test(src));
ok('接线: serializeScene 导出', src.includes('sunNeeOn: s.sunNeeOn, sunSoftOn: s.sunSoftOn'));
ok('接线: deserializeScene 默认 false', src.includes("bool('sunSoftOn', false)"));
ok('接线: validateScene 布尔校验', src.includes("bool('sunSoftOn'); bool('rrOn')"));
ok('接线: presetToParams 默认 false', src.includes('sunSoftOn: bool(p.sunSoftOn)'));
{
  const m = src.match(/sunNeeOn=s\.sunNeeOn; sunSoftOn=s\.sunSoftOn;/g) || [];
  ok('接线: applyPreset + 导入两处赋值', m.length === 2);
}
ok('接线: syncSceneUI 守护回填', src.includes("if($('sunSoft')) $('sunSoft').checked = sunSoftOn;"));
ok('接线: onchange 开关', src.includes("$('sunSoft').onchange = e=>{ sunSoftOn = e.target.checked; clearAccum(); }"));
ok('接线: 导出对象字面量携带字段', /neeOn, sunNeeOn, sunSoftOn, envInt,/.test(src));
ok('接线: uniform 上传', src.includes("gl.uniform1f(u(ptProg,'uSunSoft'), sunSoftOn ? 1.0 : 0.0)"));
ok('UI: index.html sunSoft 复选框（默认不勾——性能保守）', /id="sunSoft"[^>]*\/>/.test(ihtml) && !/id="sunSoft"[^>]*checked/.test(ihtml));
ok('UI: 复选框文案含性能提示', ihtml.includes('性能换画质'));

console.log('softshadow: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
