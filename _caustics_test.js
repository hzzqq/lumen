// Lumen 太阳锥采样 + 玻璃球解析焦散单元测试：从 main.js 抽取【真实生产函数】
// solidAngleOf/sunConeSample/refractSphereExit/causticGain（GLSL sunDirect 的 JS 镜像），
// 断言立体角、锥采样均匀性、双折射 Snell 对称性、焦斑增益；另对 GLSL sunDirect 与
// sunNeeOn 十处接线做结构守护（shader 本体不可 Node 烘焙，接线缺失 = 功能静默失效）。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const ihtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// brace 计数抽取（CRLF 免疫，同 _terrain_test.js 方法）
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
const code = [
  extractFn('solidAngleOf'), extractFn('sunConeSample'),
  extractFn('refractSphereExit'), extractFn('causticGain')
].join('\n');
const { solidAngleOf, sunConeSample, refractSphereExit, causticGain } =
  new Function(code + '\nreturn { solidAngleOf, sunConeSample, refractSphereExit, causticGain };')();

const TAU = Math.PI * 2;

// ---- 1) solidAngleOf：立体角 2π(1-cosθ) ----
ok('solidAngleOf(0)=0', Math.abs(solidAngleOf(0)) < 1e-12);
ok('solidAngleOf(π/2)=2π（半球）', Math.abs(solidAngleOf(Math.PI/2) - TAU) < 1e-9);
ok('solidAngleOf(π)=4π（全立体角）', Math.abs(solidAngleOf(Math.PI) - 2*TAU) < 1e-9);
{
  const om = solidAngleOf(0.0304);   // 太阳盘半角（pow(s,1500) 半功率点）
  ok('太阳盘立体角 ≈0.0028 sr', om > 0.0025 && om < 0.0032);
}

// ---- 2) sunConeSample：锥内面积均匀采样几何 ----
{
  const ax = [0,1,0];
  const d0 = sunConeSample(ax, 0.1, 0.3, 0);
  ok('r2=0 采样回轴', Math.abs(d0[1]-1) < 1e-9 && Math.abs(d0[0]) < 1e-9 && Math.abs(d0[2]) < 1e-9);
  ok('采样返回单位向量', Math.abs(Math.hypot(...d0) - 1) < 1e-9);
  const d1 = sunConeSample(ax, 0.1, 0.0, 1);
  ok('r2=1 落锥缘（夹角=angRad）', Math.abs(Math.acos(d1[1]) - 0.1) < 1e-9);
  const d2 = sunConeSample(ax, 0.1, 0.0, 0.5);
  ok('r2=0.5 夹角介于轴与锥缘', Math.acos(d2[1]) > 0 && Math.acos(d2[1]) < 0.1);
  ok('确定性（同参同果）', JSON.stringify(sunConeSample(ax, 0.2, 0.4, 0.7)) === JSON.stringify(sunConeSample(ax, 0.2, 0.4, 0.7)));
  let inCone = true;
  for(let i = 0; i < 200; i++){
    const d = sunConeSample(ax, 0.15, (i*0.618)%1, (i*0.377)%1);
    if(d[1] < Math.cos(0.15) - 1e-9) inCone = false;
  }
  ok('200 次采样全部落锥内', inCone);
  const d3 = sunConeSample([0,0,1], 0.1, 0.2, 0.3);
  ok('+z 轴不退化（备用正交基）', Math.abs(Math.hypot(...d3) - 1) < 1e-9);
  const d4 = sunConeSample([0,0,-1], 0.1, 0.2, 0.3);
  ok('-z 轴不退化（备用正交基）', Math.abs(Math.hypot(...d4) - 1) < 1e-9);
}

// ---- 3) refractSphereExit：双次折射解析 ----
{
  const C = [0,0,0], R = 1.0, ior = 1.5;
  const r0 = refractSphereExit([1,0,0], C, R, [-1,0,0], ior);
  ok('正入射直线穿心（P2=对侧）', r0 && Math.abs(r0.p2[0]+1) < 1e-9 && Math.abs(r0.p2[1]) < 1e-9 && Math.abs(r0.p2[2]) < 1e-9);
  ok('正入射出射方向不变', r0 && Math.abs(r0.dir[0]+1) < 1e-9 && Math.abs(r0.dir[1]) < 1e-9 && Math.abs(r0.dir[2]) < 1e-9);
  ok('出射点在球面', Math.abs(Math.hypot(...r0.p2) - R) < 1e-9);
  // 斜入射：Snell 对称（入射角正弦 = 出射角正弦，平行界面往返净偏转仅平移）
  const P1 = [Math.cos(0.5), Math.sin(0.5), 0];
  const wi = [0,-1,0];
  const r1v = refractSphereExit(P1, C, R, wi, ior);
  ok('斜入射返回非 null（无 TIR）', !!r1v);
  if(r1v){
    const theta1 = Math.acos(-(wi[0]*P1[0]+wi[1]*P1[1]+wi[2]*P1[2]));
    const n2 = r1v.p2.map(v=>v/R);
    const cosE = r1v.dir[0]*n2[0] + r1v.dir[1]*n2[1] + r1v.dir[2]*n2[2];
    const sinE = Math.sqrt(Math.max(0, 1-cosE*cosE));
    ok('Snell 对称（sin入射=sin出射）', Math.abs(Math.sin(theta1) - sinE) < 1e-9);
    ok('斜入射出射点在球面', Math.abs(Math.hypot(...r1v.p2) - R) < 1e-9);
    ok('出射方向单位长度', Math.abs(Math.hypot(...r1v.dir) - 1) < 1e-12);
  }
  // 单球穿出恒无 TIR（内部角 ≤ 临界角 asin(1/ior)）：扫 120 组入射几何
  let neverNull = true;
  for(let i = 1; i < 120; i++){
    const a = i/120*Math.PI;
    const P = [Math.cos(a), Math.sin(a), 0.3];
    const L = Math.hypot(...P);
    const Pn = P.map(v=>v/L*R);
    const w = [0,-1,-0.2], wl = Math.hypot(...w);
    if(!refractSphereExit(Pn, C, R, w.map(v=>v/wl), ior)){ neverNull = false; break; }
  }
  ok('单球穿出恒无 TIR（120 采样）', neverNull);
}

// ---- 4) causticGain：抛物焦距 + 高斯斑 ----
{
  const C = [0,0,0], R = 1, ior = 1.5;
  const r = refractSphereExit([1,0,0], C, R, [-1,0,0], ior);
  const f = ior*R/(2*(ior-1));
  ok('焦距公式 f=ior·R/(2(ior-1))，R=1,n=1.5 → 1.5', Math.abs(f - 1.5) < 1e-12);
  const F = [r.p2[0]+r.dir[0]*f, r.p2[1]+r.dir[1]*f, r.p2[2]+r.dir[2]*f];
  ok('焦点位置 = P2 + de·f（正入射 → -2.5）', Math.abs(F[0]+2.5) < 1e-9 && Math.abs(F[1]) < 1e-9);
  ok('焦点处增益 = 1', Math.abs(causticGain(F, r.p2, r.dir, R, ior) - 1) < 1e-12);
  ok('2σ 处增益 = e^-4（σ=0.35R）', Math.abs(causticGain([F[0]-0.7, F[1], F[2]], r.p2, r.dir, R, ior) - Math.exp(-4)) < 1e-9);
  ok('增益随距离单调衰减', causticGain([F[0]-0.2,0,0], r.p2, r.dir, R, ior) > causticGain([F[0]-0.4,0,0], r.p2, r.dir, R, ior));
  ok('远点增益趋零', causticGain([100,0,0], r.p2, r.dir, R, ior) < 1e-8);
}

// ---- 5) GLSL sunDirect 结构守护（shader 不可烘焙，防接线静默丢失） ----
ok('GLSL: Hit 结构含 float rad', /struct Hit \{[^}]*float rad;/.test(src));
ok('GLSL: scene() 内 best.rad 初始化', src.includes('best.t=1e30; best.rad=0.0;'));
{
  const m = src.match(/best\.rad=/g) || [];
  ok('GLSL: rad 初始化 + 5 处玻璃球赋值（≥6）', m.length >= 6);
}
ok('GLSL: sunDirect 函数定义', src.includes('vec3 sunDirect(vec3 p, vec3 n, vec3 albedo)'));
ok('GLSL: uSunNee uniform 声明', src.includes('uniform float uSunNee;'));
ok('GLSL: radiance 中 mat==0 门控调用', /uSunNee > 0\.5 && h\.mat==0\)\{ L \+= thr \* sunDirect/.test(src));
ok('GLSL: 焦散分支含双折射 + 高斯斑关键量', src.includes('float f = ior*sh.rad/(2.0*(ior-1.0));') && src.includes('float gain = exp(-dot(p-F, p-F)/(sigma*sigma));'));

// ---- 6) sunNeeOn 接线守护（镜像 neeOn 十处） ----
ok('接线: let 链声明 sunNeeOn=true', /let sceneId=0,[\s\S]{0,400}?sunNeeOn=true,/.test(src));
ok('接线: serializeScene 导出', src.includes('sunNeeOn: s.sunNeeOn'));
ok('接线: deserializeScene 默认 true', src.includes("bool('sunNeeOn', true)"));
ok('接线: validateScene 布尔校验', src.includes("bool('sunNeeOn')"));
ok('接线: presetToParams 默认 true（预设未声明不关闭）', src.includes('sunNeeOn: p.sunNeeOn !== false'));
{
  const m = src.match(/sunNeeOn=s\.sunNeeOn;/g) || [];
  ok('接线: applyPreset + 导入两处赋值', m.length === 2);
}
ok('接线: syncSceneUI 守护回填', src.includes("if($('sunNee')) $('sunNee').checked = sunNeeOn;"));
ok('接线: onchange 开关', src.includes("$('sunNee').onchange = e=>{ sunNeeOn = e.target.checked; clearAccum(); }"));
ok('接线: 导出对象字面量携带字段', /denIters, neeOn, sunNeeOn, envInt,/.test(src));
ok('接线: uniform 上传', src.includes("gl.uniform1f(u(ptProg,'uSunNee'), sunNeeOn ? 1.0 : 0.0)"));
ok('UI: index.html sunNee 复选框（默认勾选）', /id="sunNee"[^>]*checked/.test(ihtml));

console.log('caustics: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
