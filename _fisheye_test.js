// _fisheye_test.js — ci313 鱼眼相机：新能力(uFisheye 桶形径向畸变) + R2(全链路接线 fisheye: state/serialize/deserialize/preset/apply/import/export/uniform/syncUI)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：鱼眼相机全链路 ----
ok('PT 着色器声明 uniform float uFisheye', /uniform float uFisheye;/.test(main));
ok('PT main 含鱼眼径向畸变分支 if(uFisheye>0.0)', /if\(uFisheye > 0\.0\)\{[\s\S]*length\(uv\)[\s\S]*rr = r \* \(1\.0 \+ uFisheye \* 0\.65 \* r \* r\)/.test(main));
ok('state 默认含 fisheye=0', /let sceneId=0,[\s\S]*\bfisheye=0\b/.test(main));
ok('serializeScene 含 fisheye: s.fisheye', /fisheye: s\.fisheye/.test(main));
ok('deserializeScene 含 fisheye: num', /fisheye: num\('fisheye', 0\)/.test(main));
ok('presetToParams 含 fisheye: num', /fisheye: num\(p\.fisheye, 0\)/.test(main));
ok('applyPreset/importScene 含 fisheye=s.fisheye', /fisheye=s\.fisheye;/.test(main));
ok('exportScene 调用传入 fisheye', /fisheye \}\)/.test(main));
ok('loop 中绑定 u(ptProg,\'uFisheye\')', /u\(ptProg,'uFisheye'\)/.test(main));
ok('syncSceneUI 恢复 fisheye 滑块', /\$\('fisheye'\)\.value = Math\.round\(fisheye \* 100\)/.test(main));
ok('oninput 处理器更新 fisheye', /\$\('fisheye'\)\.oninput/.test(main));
ok('index.html 含 fisheye 滑块', /id="fisheye"/.test(html));

// ---- 行为验证：移植鱼眼畸变数学，确认 k=0 恒等、k>0 边缘外扩(球面膨胀) ----
function distort(uvx, uvy, k) {
  if (k <= 0) return [uvx, uvy];
  const r = Math.hypot(uvx, uvy);
  const rr = r * (1 + k * 0.65 * r * r);
  if (r > 1e-5) return [uvx * (rr / r), uvy * (rr / r)];
  return [uvx, uvy];
}
const id = distort(0.5, 0.5, 0);
ok('k=0 时为恒等(无畸变)', Math.abs(id[0] - 0.5) < 1e-9 && Math.abs(id[1] - 0.5) < 1e-9);
const c = distort(0, 0, 1);
ok('k>0 中心(0,0)保持不动', Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9);
const corner = distort(0.8, 0, 1);
ok('k>0 边缘向外扩张(半径增大)', corner[0] > 0.8 + 1e-6);
const diag = distort(0.6, 0.6, 0.8);
ok('k>0 对角方向保持径向(比例不变)', Math.abs((diag[0] / diag[1]) - 1.0) < 1e-9);

console.log(`[Lumen fisheye] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
