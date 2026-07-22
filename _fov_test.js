// ci109 Lumen 视野 FOV —— 忠实移植 + 源码接线检查
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };

// 忠实移植 main.js：度 -> 弧度，shader 用 tan(uFov*0.5) 计算半视野正切
const deg2rad = d => d * Math.PI / 180;
function halfTan(fovDeg){ return Math.tan(deg2rad(fovDeg) * 0.5); }

ok('默认 fov = 50', 50 === 50);
// 角度->弧度
ok('deg2rad(50) ≈ 0.8727', Math.abs(deg2rad(50) - 0.8726646259971648) < 1e-9);
ok('deg2rad(90) = π/2', Math.abs(deg2rad(90) - Math.PI/2) < 1e-9);
ok('deg2rad(20) < deg2rad(50) < deg2rad(100)', deg2rad(20) < deg2rad(50) && deg2rad(50) < deg2rad(100));
// 半视野正切：FOV 越大视野越宽(tan 单调增)
ok('halfTan 随 FOV 增大', halfTan(20) < halfTan(50) && halfTan(50) < halfTan(100));
ok('halfTan(50) > 0', halfTan(50) > 0);

// 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('状态含 fov=50', /fov=50,/.test(main));
ok('serializeScene 含 fov', /fov: s\.fov/.test(main));
ok('deserializeScene 含 fov', /fov: Math\.max\(1, Math\.min\(179, num\('fov', 50\)\)\)/.test(main));
ok('presetToParams 含 fov', /fov: Math\.max\(1, Math\.min\(179, num\(p\.fov, 50\)\)\)/.test(main));
ok('applyPreset/importScene 赋值 fov', /fov=s\.fov;/.test(main));
ok('uniform 绑定 uFov(弧度)', /uniform1f\(u\(ptProg,'uFov'\), fov\*Math\.PI\/180\)/.test(main));
ok('exportScene 含 fov 参数', /fogColor, fov, bgTop, bgBottom, debugMode, toneMode/.test(main));
ok('UI oninput 绑定 fov', /\$\('fov'\)\.oninput/.test(main));
ok('syncSceneUI 同步 fov', /\$\('fov'\)\.value = fov;/.test(main));
ok('index.html 含 FOV 滑块', /id="fov"/.test(html));

console.log(`\nci109 fov: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
