// _torus_test.js — ci317 SDF 圆环基元 + 行星环场景：新能力(scene 8 + marchTorus) + R2(退化法线 NaN 防御)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：SDF 圆环基元 + 行星环场景(scene 8) ----
ok('GLSL 含 SDF 距离场 sdTorusD', /float sdTorusD\(vec3 p, vec3 c, float R, float r, float a\)\{/.test(main));
ok('GLSL 含圆环光线步进 marchTorus', /float marchTorus\(vec3 ro, vec3 rd, vec3 c, float R, float r, float a, out vec3 n\)\{/.test(main));
ok('PT 着色器含场景 8 分支 if(uScene==8)', /if\(uScene==8\)\{[\s\S]*marchTorus/.test(main));
ok('场景 8 用 SDF 圆环作行星环', /marchTorus\(ro, rd, planet, 3\.4, 0\.55, 0\.5, rn\)/.test(main));
ok('R2: marchTorus 含退化法线防御(normalize 前判长度)', /length\(g\) < 1e-6/.test(main));
ok('index.html 场景下拉含 行星与环 option value=8', /<option value="8">行星与环/.test(html));

// ---- 行为验证：移植 sdTorusD / marchTorus 数学 ----
function sdTorusD(px, py, pz, c, R, r, a) {
  let qx = px - c[0], qy = py - c[1], qz = pz - c[2];
  const ca = Math.cos(a), sa = Math.sin(a);
  const ny = ca * qy - sa * qz, nz = sa * qy + ca * qz;
  qy = ny; qz = nz;
  const tr = Math.hypot(qx, qz) - R;
  return Math.hypot(tr, qy) - r;
}
function marchTorus(ro, rd, c, R, r, a) {
  let t = 0.02;
  for (let i = 0; i < 128; i++) {
    const px = ro[0] + rd[0] * t, py = ro[1] + rd[1] * t, pz = ro[2] + rd[2] * t;
    const d = sdTorusD(px, py, pz, c, R, r, a);
    if (d < 5e-4) {
      const e = 1e-3;
      const gx = sdTorusD(px + e, py, pz, c, R, r, a) - sdTorusD(px - e, py, pz, c, R, r, a);
      const gy = sdTorusD(px, py + e, pz, c, R, r, a) - sdTorusD(px, py - e, pz, c, R, r, a);
      const gz = sdTorusD(px, py, pz + e, c, R, r, a) - sdTorusD(px, py, pz - e, c, R, r, a);
      const gl = Math.hypot(gx, gy, gz);
      const n = gl < 1e-6 ? [0, 0, -1] : [gx / gl, gy / gl, gz / gl];
      return { t, n };
    }
    t += d;
    if (t > 60) break;
  }
  return null;
}
const c = [0, 0, -3.6], R = 3.4, r = 0.55;
// 表面点(管外侧, 无倾斜, 位于圆环平面 pz=c[2])距离=0
ok('sdTorusD 在圆环表面为 ~0', Math.abs(sdTorusD(c[0] + R + r, 0, c[2], c, R, r, 0)) < 1e-6);
// 命中：轴外 R 处沿 -z 射线应击中环管
const hit = marchTorus([c[0] + R, 0, 5], [0, 0, -1], c, R, r, 0);
ok('射线命中圆环返回正 t', hit && hit.t > 0);
ok('命中法线有限(无 NaN)', hit && isFinite(hit.n[0]) && isFinite(hit.n[1]) && isFinite(hit.n[2]));
// 偏离管外的平行射线应错过
const miss = marchTorus([c[0] + R + 5, 0, 5], [0, 0, -1], c, R, r, 0);
ok('远离管外的射线未命中(返回 null)', miss === null);

console.log(`[Lumen torus] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
