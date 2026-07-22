// _pointlight_test.js — ci321 解析点光源：新能力(uPointOn/Pos/Color/Int + pointLight) + R2(近距钳制避免爆点)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：解析点光源全链路 ----
ok('PT 着色器声明 uniforms uPointOn/uPointPos/uPointColor/uPointInt',
  /uniform float uPointOn;/.test(main) && /uniform vec3  uPointPos;/.test(main) && /uniform vec3  uPointColor;/.test(main) && /uniform float uPointInt;/.test(main));
ok('GLSL 含 pointLight 函数', /vec3 pointLight\(vec3 p, vec3 n, vec3 albedo\)\{/.test(main));
ok('radiance 对漫反射调用 pointLight(if uPointOn)', /if\(uPointOn > 0\.5 && h\.mat==0\)\{ L \+= thr \* pointLight\(h\.p, h\.n, h\.albedo\); \}/.test(main));
ok('R2: pointLight 含近距钳制 max(dist, 0.05)', /float distC = max\(dist, 0\.05\);/.test(main));
ok('state 默认含 pointOn/pointPos/pointColor/pointInt',
  /let sceneId=0,[\s\S]*\bpointOn=0\b/.test(main) && /pointPos=\[3,4,-2\]/.test(main) && /pointColor=\[1,0\.9,0\.8\]/.test(main) && /pointInt=8\b/.test(main));
ok('serializeScene 含 pointOn: s.pointOn', /pointOn: s\.pointOn/.test(main));
ok('deserializeScene 含 point 字段', /pointOn: bool\('pointOn', false\)/.test(main) && /pointPos: fin3/.test(main) && /pointColor: fin3/.test(main) && /pointInt: Math\.max\(0, num\('pointInt', 8\)\)/.test(main));
ok('presetToParams 含 point 字段', /pointOn: bool\(p\.pointOn\)/.test(main) && /pointInt: Math\.max\(0, num\(p\.pointInt, 8\)\)/.test(main));
ok('applyPreset/importScene 含 pointOn=s.pointOn', /pointOn=s\.pointOn;/.test(main));
ok('exportScene 调用传入 point 字段', /serializeScene\(\{[\s\S]*\bpointInt\b[\s\S]*\}\)/.test(main));
ok('loop 绑定 uPointOn/uPointPos/uPointColor/uPointInt', /u\(ptProg,'uPointOn'\)/.test(main) && /u\(ptProg,'uPointPos'\)/.test(main) && /u\(ptProg,'uPointColor'\)/.test(main) && /u\(ptProg,'uPointInt'\)/.test(main));
ok('syncSceneUI 恢复 pointOn/pointInt', /\$\('pointOn'\)\.checked = pointOn/.test(main) && /\$\('pointInt'\)\.value = Math\.round\(pointInt \* 10\)/.test(main));
ok('oninput/onchange 处理器', /\$\('pointOn'\)\.onchange/.test(main) && /\$\('pointInt'\)\.oninput/.test(main));
ok('index.html 含 pointOn/pointInt 控件', /id="pointOn"/.test(html) && /id="pointInt"/.test(html));

// ---- 行为验证：移植 pointLight 数学(无遮挡) ----
function pointLight(p, n, albedo, Lp, Lc, Lint) {
  const wx = Lp[0]-p[0], wy = Lp[1]-p[1], wz = Lp[2]-p[2];
  const dist2 = wx*wx + wy*wy + wz*wz, dist = Math.sqrt(dist2);
  const wix = wx/dist, wiy = wy/dist, wiz = wz/dist;
  const cosS = n[0]*wix + n[1]*wiy + n[2]*wiz;
  if (cosS <= 0) return [0,0,0];
  const distC = Math.max(dist, 0.05);            // R2 钳制
  const atten = 1/(distC*distC);
  const k = (1/Math.PI) * Lint * atten * cosS;
  return [albedo[0]*Lc[0]*k, albedo[1]*Lc[1]*k, albedo[2]*Lc[2]*k];
}
const surf = [0,0,0], nrm = [0,0,1], alb = [0.8,0.8,0.8], Lc = [1,1,1];
const lit = pointLight(surf, nrm, alb, [0,0,5], Lc, 8);
ok('面向点光源的漫反射得到正贡献', lit[0] > 0 && lit[1] > 0 && lit[2] > 0);
ok('贡献随反向平方衰减(近>远)', (()=>{
  const near = pointLight(surf, nrm, alb, [0,0,2], Lc, 8);
  const far  = pointLight(surf, nrm, alb, [0,0,8], Lc, 8);
  return near[0] > far[0];
})());
const back = pointLight(surf, [0,0,-1], alb, [0,0,5], Lc, 8);
ok('背向点光源返回 0(cosS<=0)', back[0] === 0 && back[1] === 0 && back[2] === 0);
const clamped = pointLight(surf, nrm, alb, [0,0,0.01], Lc, 8);   // 极近距
ok('近距钳制使贡献有限(无 NaN/Inf)', isFinite(clamped[0]) && clamped[0] > 0 && clamped[0] < 1000);

console.log(`[Lumen pointlight] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
