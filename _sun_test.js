// 太阳方向/强度测试：忠实复刻 main.js 的 computeSunDir 与 sky() 里太阳盘+辉光贡献
// GLSL sky():
//   float s = max(dot(d, uSunDir), 0.0);
//   col += vec3(22,18,13) * uSunInt * pow(s,1500.0);   // 太阳盘
//   col += vec3(0.8,0.7,0.55) * uSunInt * pow(s,6.0);  // 太阳辉光
'use strict';

// 由方位角/高度角计算太阳单位方向（与 main.js computeSunDir 一致）
function computeSunDir(azDeg, elDeg){
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
  const ce = Math.cos(el);
  return [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
}
function dot3(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
// 单通道（标量，RGB 同比例）太阳贡献，inten 为 uSunInt
function sunContribution(dir, sunDir, inten){
  const s = Math.max(dot3(dir, sunDir), 0);
  const disk = 22 * inten * Math.pow(s, 1500);
  const glow = 0.8 * inten * Math.pow(s, 6);
  return disk + glow;
}

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; } else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. computeSunDir 单位长度（任意 az/el）
for(const [az, el] of [[0,0],[35,40],[90,0],[180,30],[270,-5],[359,85]]){
  const d = computeSunDir(az, el);
  ok(approx(Math.hypot(d[0], d[1], d[2]), 1, 1e-9), `computeSunDir(${az},${el}) 单位长度`);
}

// 2. 高度角映射到 y = sin(el)
ok(approx(computeSunDir(0, 90)[1], 1, 1e-9), 'el=90° 时 y≈1 (正天顶)');
ok(approx(computeSunDir(123, 0)[1], 0, 1e-9), 'el=0° 时 y=0 (地平线)');
ok(approx(computeSunDir(123, -5)[1], Math.sin(-5*Math.PI/180), 1e-9), 'el=-5° 时 y=sin(-5°)');

// 3. 方位角映射到水平分量（el=0 时）
ok(approx(computeSunDir(0, 0)[0], 0, 1e-9) && approx(computeSunDir(0, 0)[2], 1, 1e-9), 'az=0,el=0 → +Z');
ok(approx(computeSunDir(90, 0)[0], 1, 1e-9) && approx(computeSunDir(90, 0)[2], 0, 1e-9), 'az=90,el=0 → +X');

// 4. 默认太阳(35°,40°) 合理（与地面法线 +Y 不平行，也不反向）
const def = computeSunDir(35, 40);
ok(def[1] > 0 && def[1] < 1, '默认太阳高度角 40° → 0<y<1');

// 5. 对齐方向贡献极大（基本等于太阳盘）
const sd = computeSunDir(35, 40);
const aligned = sunContribution(sd, sd, 1);
ok(aligned > 20, '方向对齐太阳 → 贡献 >20 (太阳盘主导)');
ok(approx(aligned, 22 * 1 * 1 + 0.8 * 1 * 1, 1e-6), '对齐时贡献 = 22+0.8 = 22.8 (inten=1)');

// 6. 垂直方向贡献≈0
const perp = [sd[2], 0, -sd[0]]; // 与 sd 正交
ok(sunContribution(perp, sd, 1) < 1e-6, '垂直方向 → 贡献≈0');

// 7. 强度线性缩放
ok(approx(sunContribution(sd, sd, 2), aligned * 2, 1e-6), 'inten=2 时贡献 = inten=1 的 2 倍');

// 8. 强度为 0 → 贡献恒为 0（不论方向）
ok(approx(sunContribution(sd, sd, 0), 0, 1e-12), 'inten=0 → 无太阳盘/辉光');
ok(approx(sunContribution([1,0,0], sd, 0), 0, 1e-12), 'inten=0 任意方向贡献为 0');

// 9. 贡献随对齐度单调（s 越大贡献越大）：对齐 > 45°夹角 > 90°
const d45 = [Math.cos(Math.PI/4), Math.sin(Math.PI/4)*0 + Math.cos(Math.PI/4)*0, 0]; // 取与 sd 夹角 45° 的向量
// 构造与 sd 夹角 45° 的向量：在 sd 与某正交基之间插值
function rotTo(dir, ref, ang){
  // 返回 dir 绕“与 ref 共面的正交轴”旋转 ang 后的单位向量（简单：slerp 近似用线性组合+归一）
  const c = Math.cos(ang), s = Math.sin(ang);
  // 取 dir 在 ref 上的投影与垂直分量
  const proj = dot3(ref, dir);
  const perpV = [ref[0]-dir[0]*proj, ref[1]-dir[1]*proj, ref[2]-dir[2]*proj];
  const pl = Math.hypot(perpV[0], perpV[1], perpV[2]) || 1;
  perpV[0]/=pl; perpV[1]/=pl; perpV[2]/=pl;
  return [dir[0]*c + perpV[0]*s, dir[1]*c + perpV[1]*s, dir[2]*c + perpV[2]*s];
}
const d45v = rotTo(sd, [0,1,0], Math.PI/4);
const d90v = rotTo(sd, [0,1,0], Math.PI/2);
ok(sunContribution(d45v, sd, 1) < aligned, '45°夹角贡献 < 对齐贡献');
ok(sunContribution(d90v, sd, 1) < sunContribution(d45v, sd, 1) + 1e-9, '90°夹角贡献 <= 45°夹角贡献');

console.log(`Lumen sun: ${pass} passed, ${fail} failed`);
if(fail > 0) process.exit(1);
