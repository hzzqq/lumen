// ci117 Lumen 调试视图模式 —— 忠实移植 + 源码接线检查
// 调试视图在 shader 首条命中处短路：0=成品 1=反照率 2=法线 3=景深
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const clamp = (x,a,b)=> Math.max(a, Math.min(b, x));

// 忠实移植 shader 的调试映射（首条命中 h）
function debugView(mode, hit, albedo, n, t){
  if(mode === 0) return null;                                   // 成品：走完整 PT
  if(mode === 1) return hit ? albedo.slice() : [0,0,0];         // 反照率：未命中为黑
  if(mode === 2) return hit ? [n[0]*0.5+0.5, n[1]*0.5+0.5, n[2]*0.5+0.5] : [0,0,0]; // 法线：未命中为黑
  if(mode === 3) return [clamp(hit ? t/12 : 1, 0, 1), clamp(hit ? t/12 : 1, 0, 1), clamp(hit ? t/12 : 1, 0, 1)]; // 景深：未命中为无限远灰
  return null;
}

// 映射语义
ok('mode=0 返回 null（走完整 PT）', debugView(0, true, [1,0,0], [0,1,0], 3) === null);
ok('mode=1 命中返回反照率', JSON.stringify(debugView(1, true, [0.3,0.6,0.9], [0,1,0], 3)) === JSON.stringify([0.3,0.6,0.9]));
ok('mode=1 未命中返回黑', JSON.stringify(debugView(1, false, [1,1,1], [0,1,0], 3)) === JSON.stringify([0,0,0]));
ok('mode=2 法线映射 n*0.5+0.5', JSON.stringify(debugView(2, true, [0,0,0], [1,0,0], 3)) === JSON.stringify([1,0.5,0.5]));
ok('mode=2 负法线映射到 [0,1]', JSON.stringify(debugView(2, true, [0,0,0], [-1,0,0], 3)) === JSON.stringify([0,0.5,0.5]));
ok('mode=3 景深 t/12 归一化', JSON.stringify(debugView(3, true, [0,0,0], [0,1,0], 6)) === JSON.stringify([0.5,0.5,0.5]));
ok('mode=3 越界景深被钳制到 1', JSON.stringify(debugView(3, true, [0,0,0], [0,1,0], 30)) === JSON.stringify([1,1,1]));
ok('mode=3 未命中景深=1（无限远灰）', JSON.stringify(debugView(3, false, [0,0,0], [0,1,0], 0)) === JSON.stringify([1,1,1]));

// 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('PT shader 声明 uniform int uDebug', /uniform int\s+uDebug;/.test(main));
ok('radiance 短路 uDebug==1 反照率', /if\(uDebug == 1\) return h\.hit \? h\.albedo : vec3\(0\.0\);/.test(main));
ok('radiance 短路 uDebug==2 法线', /uDebug == 2\) return h\.hit \? h\.n\*0\.5\+0\.5 : vec3\(0\.0\);/.test(main));
ok('radiance 短路 uDebug==3 景深', /uDebug == 3\) return vec3\(clamp\(h\.hit \? h\.t\/12\.0 : 1\.0, 0\.0, 1\.0\)\);/.test(main));
ok('状态含 debugMode=0', /debugMode=0[,;]/.test(main));
ok('serializeScene 含 debugMode', /debugMode: s\.debugMode/.test(main));
ok('deserializeScene 含 debugMode', /debugMode: num\('debugMode', 0\)\|0/.test(main));
ok('presetToParams 含 debugMode', /debugMode: num\(p\.debugMode, 0\)\|0/.test(main));
ok('applyPreset/importScene 赋值 debugMode', /debugMode=s\.debugMode;/.test(main));
ok('uniform 绑定 uDebug', /uniform1i\(u\(ptProg,'uDebug'\), debugMode\)/.test(main));
ok('exportScene 序列化含 debugMode', /bgTop, bgBottom, debugMode, toneMode/.test(main));
ok('UI onchange 绑定 debug', /\$\('debug'\)\.onchange/.test(main));
ok('syncSceneUI 同步 debug', /\$\('debug'\)\.value = String\(debugMode\)/.test(main));
ok('index.html 含调试视图下拉', /id="debug"/.test(html));

console.log(`\nci117 debug: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
