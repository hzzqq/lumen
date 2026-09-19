// Lumen 体积雾受光散射单元测试：JS 镜像纯函数 fogPhase（前向散射相位）烘焙断言，
// GLSL 雾分支受光重构以结构守护为主（环境底色 amb / 太阳直射 Le·Ω / 段中点阴影射线 /
// fogGlow 十处接线 / UI 滑条 / 字段数演进）。
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
const { fogPhase } = new Function(extractFn('fogPhase') + '\nreturn { fogPhase };')();

// ---- 1) fogPhase：前向散射相位数学 ----
ok('fogPhase 朝太阳（cos=1）= 1+glow', Math.abs(fogPhase(1, 8) - 9) < 1e-12);
ok('fogPhase 背太阳（cos<0）= 1（max(0,·) 截断）', Math.abs(fogPhase(-1, 8) - 1) < 1e-12 && Math.abs(fogPhase(-0.3, 8) - 1) < 1e-12);
ok('fogPhase 垂直（cos=0）= 1', Math.abs(fogPhase(0, 8) - 1) < 1e-12);
ok('fogPhase glow=0 各向同性（任意角恒 1）', Math.abs(fogPhase(1, 0) - 1) < 1e-12 && Math.abs(fogPhase(-0.7, 0) - 1) < 1e-12);
ok('fogPhase 随 cos 单调增（前向更亮）', (()=>{
  for(let i = 0; i < 20; i++){
    const a = fogPhase(i/20, 8), b = fogPhase((i+1)/20, 8);
    if(b < a) return false;
  }
  return true;
})());
ok('fogPhase 六次幂窄峰（cos=0.5 增益 < 0.15×峰值增益）', fogPhase(0.5, 8) - 1 < 0.15 * 8);
ok('fogPhase 确定性', fogPhase(0.7, 8) === fogPhase(0.7, 8));

// ---- 2) GLSL 雾分支受光结构守护 ----
ok('GLSL: uFogGlow uniform 声明', src.includes('uniform float uFogGlow;'));
ok('GLSL: 环境底色照明（bgTop/bgBottom 混合，不含太阳盘防过曝）', src.includes('vec3 amb = mix(uBgBottom, uBgTop, clamp(rd.y*0.5+0.5, 0.0, 1.0)) * uEnv;'));
ok('GLSL: 相位函数同式（1+glow·pow^6）', src.includes('float phase = 1.0 + uFogGlow * pow(max(dot(rd, uSunDir), 0.0), 6.0);'));
ok('GLSL: 段中点太阳阴影射线（截断防 1e9 长段）', src.includes('vec3 mid = ro + rd * (min(seg, 40.0) * 0.5);') && src.includes('Hit sh = scene(mid, uSunDir);'));
ok('GLSL: 太阳直射 Le·Ω 近似（受 sunInt/sunNee 门控）', src.includes('sunLe = vec3(22.0,18.0,13.0) * uSunInt * uEnv * 0.00283;') && src.includes('if(uSunInt > 0.0 && uSunNee > 0.5){'));
ok('GLSL: 雾受光合成 fogCol·(amb + sunLe·phase)', src.includes('vec3 fogLit = uFogColor * (amb + sunLe * phase);'));
ok('GLSL: 透过率衰减保留', src.includes('thr *= (1.0 - fogA);'));

// ---- 3) fogGlow 十处接线（默认 8） ----
ok('接线: let 链声明 fogGlow=8', /fogColor=\[0\.8,0\.85,0\.9\], fogGlow=8, fov=50/.test(src));
ok('接线: serializeScene 导出', src.includes('fogDensity: s.fogDensity, fogGlow: s.fogGlow'));
ok('接线: deserializeScene 默认 8', src.includes("fogGlow: num('fogGlow', 8)"));
ok('接线: presetToParams 默认 8', src.includes('fogDensity: num(p.fogDensity, 0), fogGlow: num(p.fogGlow, 8)'));
{
  const m = src.match(/fogDensity=s\.fogDensity; fogGlow=s\.fogGlow;/g) || [];
  ok('接线: applyPreset + 导入两处赋值', m.length === 2);
}
ok('接线: syncSceneUI 守护回填', src.includes("if($('fogGlow')) $('fogGlow').value = fogGlow;"));
ok('接线: oninput 滑条', src.includes("$('fogGlow').oninput = e=>{ fogGlow = +e.target.value;"));
ok('接线: 导出对象字面量携带字段', /autoExp, fogDensity, fogGlow, rrOn,/.test(src));
ok('接线: uniform 上传', src.includes("gl.uniform1f(u(ptProg,'uFogGlow'), fogGlow)"));
ok('UI: index.html fogGlow 滑条（默认 8，0..30）', /id="fogGlow"[^>]*min="0"[^>]*max="30"[^>]*value="8"/.test(ihtml));
ok('UI: 滑条副文案说明光柱语义', ihtml.includes('视线朝太阳时雾更亮（体积光柱）'));

console.log('foglight: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
