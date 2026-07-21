// ci121 Lumen 萤火虫钳制 —— 忠实移植 + 源码接线检查
// 单样本辐射上限：uClamp>0 时钳制每个分量为 [0,uClamp]，抑制爆点噪声；0=关闭。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };
const clamp = (x,a,b)=> Math.max(a, Math.min(b, x));

// 忠实移植 shader 钳制：min(L, vec3(uClamp))
function clampRadiance(rgb, max){
  if(max <= 0) return rgb.slice();                    // 关闭：原样返回
  return [clamp(rgb[0], 0, max), clamp(rgb[1], 0, max), clamp(rgb[2], 0, max)];
}

// 关闭时原样返回
ok('clampRad=0 不钳制', JSON.stringify(clampRadiance([5,9,2], 0)) === JSON.stringify([5,9,2]));
// 钳制超出上限的分量
ok('超上限分量被钳到 max', JSON.stringify(clampRadiance([5,9,2], 4)) === JSON.stringify([4,4,2]));
// 未超上限分量不变
ok('未超上限分量保留', JSON.stringify(clampRadiance([1,2,3], 10)) === JSON.stringify([1,2,3]));
// 负值不被钳成正数（下限 0）
ok('负值下钳到 0', JSON.stringify(clampRadiance([-3,5,-1], 4)) === JSON.stringify([0,4,0]));

// 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('PT shader 声明 uniform float uClamp', /uniform float uClamp;/.test(main));
ok('radiance 末段钳制 min(L, vec3(uClamp))', /if\(uClamp > 0\.0\) L = min\(L, vec3\(uClamp\)\);/.test(main));
ok('状态含 clampRad=0', /clampRad=0;/.test(main));
ok('serializeScene 含 clampRad', /clampRad: s\.clampRad/.test(main));
ok('deserializeScene 含 clampRad', /clampRad: num\('clampRad', 0\)/.test(main));
ok('presetToParams 含 clampRad', /clampRad: num\(p\.clampRad, 0\)/.test(main));
ok('applyPreset/importScene 赋值 clampRad', /clampRad=s\.clampRad;/.test(main));
ok('uniform 绑定 uClamp', /uniform1f\(u\(ptProg,'uClamp'\), clampRad\)/.test(main));
ok('exportScene 序列化含 clampRad', /grainStr, gamma, clampRad/.test(main));
ok('UI oninput 绑定 firefly', /\$\('firefly'\)\.oninput/.test(main));
ok('syncSceneUI 同步 firefly', /\$\('firefly'\)\.value = clampRad;/.test(main));
ok('index.html 含萤火虫钳制滑块', /id="firefly"/.test(html));

console.log(`\nci121 firefly: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
