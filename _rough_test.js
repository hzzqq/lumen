// Lumen 金属粗糙度 uRough 单元测试：忠实移植 GLSL 金属反射瓣逻辑
//   GLSL: rd = normalize(reflect(rd,n) + randUnit() * mix(0.04, 1.2, uRough))
// 在 Node 复刻数学，断言「粗糙度越大，镜面反射越模糊（与反射方向夹角越大）」等性质。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// ---- 忠实移植 GLSL 金属反射微面元近似 ----
function norm3(v){ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function dot3(a, b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
// r: 镜面反射方向(单位)，d: 随机单位方向(randUnit())，rough: 0..1
function roughSpecular(r, rough, d){
  const m = 0.04 + rough * 1.16;           // mix(0.04, 1.2, uRough)
  return norm3([r[0] + d[0]*m, r[1] + d[1]*m, r[2] + d[2]*m]);
}

const R = [0, 1, 0];     // 镜面反射方向（单位）
const D90 = [1, 0, 0];   // 与 R 正交的单位扰动

// 1) rough=0 且扰动为 0 → 精确回到镜面方向
{
  const out = roughSpecular(R, 0, [0,0,0]);
  ok('rough=0 零扰动 = 镜面方向', Math.abs(out[0]-R[0])<1e-9 && Math.abs(out[1]-R[1])<1e-9 && Math.abs(out[2]-R[2])<1e-9);
}
// 2) 输出恒为单位向量（任意粗糙/扰动）
for(const rough of [0, 0.25, 0.5, 0.75, 1, 0.13]){
  const out = roughSpecular(R, rough, D90);
  ok('rough='+rough+' 输出为单位向量', Math.abs(Math.hypot(out[0],out[1],out[2]) - 1) < 1e-9);
}
// 3) rough=0 偏差极小（近镜面）：dot(R,out) ≈ 1（与 R 正交的小扰动 scale=0.04）
{
  const out = roughSpecular(R, 0, D90);
  const d = dot3(R, out);
  ok('rough=0 偏差很小(dot>0.99)', d > 0.99 && d <= 1 + 1e-9);
}
// 4) rough=1 偏差明显（宽瓣）：dot(R,out) 明显 < 0.99
{
  const out = roughSpecular(R, 1, D90);
  const d = dot3(R, out);
  ok('rough=1 偏差明显(dot<0.99)', d < 0.99 && d > 0);
}
// 5) 单调：粗糙度越大，与镜面方向夹角越大（dot 越小）
{
  const d0 = dot3(R, roughSpecular(R, 0.0, D90));
  const d5 = dot3(R, roughSpecular(R, 0.5, D90));
  const d1 = dot3(R, roughSpecular(R, 1.0, D90));
  ok('偏差随粗糙度单调增大', d0 > d5 && d5 > d1);
}
// 6) 结果落在 r 与 d 张成的平面内（扰动不引入第三轴分量）
function cross3(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
{
  const cases = [[[0,1,0],[1,0,0]], [[1,0,0],[0,1,0]], [[0.577,0.577,0.577],[0,0,1]]];
  let allInPlane = true;
  for(const [r,d] of cases){
    const out = roughSpecular(r, 0.6, d);
    const c = cross3(r, d);
    const tp = Math.abs(dot3(c, out));   // 三重积：平面内 => 0
    if(tp > 1e-9) allInPlane = false;
  }
  ok('结果始终在 r-d 平面内', allInPlane);
}
// 7) 扰动与 R 平行时不影响镜面方向（仅在法平面内模糊）
{
  const out = roughSpecular(R, 0.5, R); // d 与 R 同向
  ok('扰动平行于 R 时仍沿 R', Math.abs(out[1]-1) < 1e-9 && Math.abs(out[0]) < 1e-9);
}
// 8) 大扰动幅值仍输出有限单位向量（鲁棒性）
{
  const out = roughSpecular(R, 1, [2, 0, 0]);
  ok('大扰动幅值输出有限单位向量', isFinite(out[0]) && Math.abs(Math.hypot(out[0],out[1],out[2])-1) < 1e-9);
}

// ---- 源码接线（确保 GLSL/JS 同步） ----
ok('GLSL 声明 uRough uniform', /uniform float uRough;/.test(src));
ok('金属分支使用 uRough 控制瓣宽', /mix\(0\.04, 1\.2, uRough\)/.test(src));
ok('JS 含 rough 状态变量', /rough=0\.0/.test(src));
ok('uniform 绑定 uRough', /u\(ptProg,'uRough'\)/.test(src));
ok('serializeScene 含 rough 字段', /rough: s\.rough/.test(src));
ok('deserializeScene 含 rough 字段', /rough: num\('rough', 0\)/.test(src));
ok('presetToParams 含 rough 字段', /rough: num\(p\.rough, 0\)/.test(src));

console.log(`[Lumen rough] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
