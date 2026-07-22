// _nebula_test.js — ci309 宇宙星云场景：新能力(scene 7 + 体积星云环境 spaceEnv) + R2(清理重复 uAnaglyph uniform)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：宇宙星云场景(sceneId=7)全链路 ----
ok('PT 着色器含星云场景分支 if(uScene==7)', /if\(uScene==7\)\{[\s\S]*spaceEnv/.test(main));
ok('GLSL 含体积星云环境函数 spaceEnv', /vec3 spaceEnv\(vec3 rd\)\{/.test(main));
ok('GLSL 含 FBM 噪声基元 fbm3/vnoise', /float vnoise\(vec3 x\)\{[\s\S]*float fbm3\(vec3 p\)\{/.test(main));
ok('radiance 未命中时场景7使用 spaceEnv', /uScene==7 \? spaceEnv\(rd\)\*uEnv : sky\(rd\)/.test(main));
ok('星云场景含气态巨行星(带状纹理)', /float band = 0\.5\+0\.5\*sin\(best\.p\.y\*2\.6/.test(main));
ok('index.html 场景下拉含 宇宙星云 option value=7', /<option value="7">宇宙星云/.test(html));
ok('R2: 无重复 uAnaglyph uniform 声明', !/uniform float uAnaglyph;uniform float uAnaglyph;/.test(main));

// ---- 行为验证：移植 spaceEnv / FBM 数学，确认星云确实产出彩色云气与稀疏星点 ----
const fract = x => x - Math.floor(x);
function hash31(x, y, z) {
  let px = fract(x * 0.3183099 + 0.1), py = fract(y * 0.3183099 + 0.1), pz = fract(z * 0.3183099 + 0.1);
  px *= 17.0; py *= 17.0; pz *= 17.0;
  return fract(px * py * pz * (px + py + pz));
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c = (i0, j0, k0) => hash31(ix + i0, iy + j0, iz + k0);
  const x00 = c(0, 0, 0) * (1 - fx) + c(1, 0, 0) * fx;
  const x10 = c(0, 1, 0) * (1 - fx) + c(1, 1, 0) * fx;
  const x01 = c(0, 0, 1) * (1 - fx) + c(1, 0, 1) * fx;
  const x11 = c(0, 1, 1) * (1 - fx) + c(1, 1, 1) * fx;
  const y0 = x00 * (1 - fy) + x10 * fy;
  const y1 = x01 * (1 - fy) + x11 * fy;
  return y0 * (1 - fz) + y1 * fz;
}
function fbm3(x, y, z) {
  let s = 0, a = 0.5, px = x, py = y, pz = z;
  for (let i = 0; i < 5; i++) { s += a * vnoise(px, py, pz); px *= 2.03; py *= 2.03; pz *= 2.03; a *= 0.5; }
  return s;
}
function spaceEnv(rx, ry, rz) {
  const p = [rx * 2.6, ry * 2.6, rz * 2.6];
  const n = fbm3(p[0], p[1], p[2]);
  const n2 = fbm3(p[0] * 1.9 + 13.1, p[1] * 1.9 + 13.1, p[2] * 1.9 + 13.1);
  let r = 0.05 + 0.5 * n, g = 0.02 + 0.12 * n, b = 0.11 + 0.5 * n; // mix(紫, 品红, n)
  r += 0.04 * n2; g += 0.13 * n2; b += 0.34 * n2;
  const m = 0.4 + 1.6 * Math.max(0, Math.min(1, (n + 0.35 * n2 - 0.30) / 0.65));
  r *= m; g *= m; b *= m;
  const spx = rx * 260, spy = ry * 260, spz = rz * 260;
  const ipx = Math.floor(spx), ipy = Math.floor(spy), ipz = Math.floor(spz);
  const starR = hash31(ipx + 3.7, ipy + 3.7, ipz + 3.7);
  const fpx = fract(spx) - 0.5, fpy = fract(spy) - 0.5, fpz = fract(spz) - 0.5;
  const d = Math.sqrt(fpx * fpx + fpy * fpy + fpz * fpz);
  const star = (d < 0.5 ? (0.5 - d) / 0.5 : 0) * (starR >= 0.988 ? 1 : 0) * 7.0;
  r += star; g += star * 0.96; b += star * 0.9;
  r += 0.012; g += 0.012; b += 0.022;
  return [r, g, b];
}
// 星云在典型视线方向上应产出可见彩色(非纯黑)
let lum = 0, stars = 0;
for (let i = 0; i < 4000; i++) {
  const a = i * 2.3999632, z = (i / 4000) * 2 - 1, rr = Math.sqrt(1 - z * z);
  const rx = rr * Math.cos(a), ry = rr * Math.sin(a), rz = z;
  const [cr, cg, cb] = spaceEnv(rx, ry, rz);
  lum += (cr + cg + cb) / 3;
  if (cr > 1.0 || cg > 1.0 || cb > 1.0) stars++;
}
ok('星云在视线方向产出可见彩色云气(平均亮度>0)', lum / 4000 > 0.001);
ok('星云含稀疏亮星(采样中出现高亮像素)', stars > 0);

console.log(`[Lumen nebula] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
