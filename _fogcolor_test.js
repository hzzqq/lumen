// ci105 Lumen 雾颜色 fogColor —— 忠实移植 + 源码接线检查
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', name); } };

// ---- 忠实移植 main.js 的 hex2rgb / rgb2hex ----
const hex2rgb = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const rgb2hex = c => '#' + c.map(v=>Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('');

// ---- 忠实移植 shader 雾混合：L += thr*fogCol*fogA; thr *= (1-fogA) ----
function applyFog(L, thr, fogCol, fogA){
  const nL = [ L[0]+thr*fogCol[0]*fogA, L[1]+thr*fogCol[1]*fogA, L[2]+thr*fogCol[2]*fogA ];
  const nThr = thr * (1 - fogA);
  return { L: nL, thr: nThr };
}

// ---- hex2rgb / rgb2hex 往返 ----
ok('hex2rgb #000000 => [0,0,0]', JSON.stringify(hex2rgb('#000000')) === JSON.stringify([0,0,0]));
ok('hex2rgb #ffffff => [1,1,1]', JSON.stringify(hex2rgb('#ffffff')) === JSON.stringify([1,1,1]));
ok('hex2rgb #ff0000 => [1,0,0]', JSON.stringify(hex2rgb('#ff0000')) === JSON.stringify([1,0,0]));
ok('rgb2hex [0,0,0] => #000000', rgb2hex([0,0,0]) === '#000000');
ok('rgb2hex [1,1,1] => #ffffff', rgb2hex([1,1,1]) === '#ffffff');
ok('rgb2hex [0.8,0.85,0.9] 默认雾色往返', rgb2hex(hex2rgb(rgb2hex([0.8,0.85,0.9]))) === rgb2hex([0.8,0.85,0.9]));
ok('hex2rgb 分量范围 0..1', hex2rgb('#80d9e6').every(v => v >= 0 && v <= 1));
ok('rgb2hex 超出范围被钳制', rgb2hex([-1, 2, 0.5]) === '#00ff80');

// ---- 默认雾色 ----
ok('默认 fogColor = [0.8,0.85,0.9]', JSON.stringify([0.8,0.85,0.9]) === JSON.stringify([0.8,0.85,0.9]));
ok('默认雾色 hex = #ccd9e6', rgb2hex([0.8,0.85,0.9]) === '#ccd9e6');

// ---- 雾混合逻辑：雾色参与 tint，且 thr 随雾衰减 ----
{
  const fc = hex2rgb('#ff0000');           // 纯红雾
  const r = applyFog([0,0,0], 1.0, fc, 0.5);
  ok('红色雾使 L 的 R 通道增大', r.L[0] > 0.4 && r.L[1] === 0 && r.L[2] === 0);
  ok('雾后 thr 衰减 (1-fogA)', Math.abs(r.thr - 0.5) < 1e-9);
}
{
  const r = applyFog([0.2,0.2,0.2], 0.5, [0,1,0], 0.0);   // fogA=0 不改变
  ok('fogA=0 不改变 L/thr', JSON.stringify(r.L) === JSON.stringify([0.2,0.2,0.2]) && r.thr === 0.5);
}

// ---- 源码接线检查 ----
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('shader 声明 uniform vec3 uFogColor', /uniform vec3\s+uFogColor;/.test(main));
ok('shader 雾色改用 uFogColor', /fogCol = uFogColor;/.test(main));
ok('fogColor 进入状态变量', /fogColor=\[0\.8,0\.85,0\.9\]/.test(main));
ok('serializeScene 含 fogColor', /fogColor: s\.fogColor/.test(main));
ok('deserializeScene 含 fogColor', /fogColor: \(Array\.isArray\(d\.fogColor\)/.test(main));
ok('presetToParams 含 fogColor', /fogColor: \(Array\.isArray\(p\.fogColor\)/.test(main));
ok('applyPreset/importScene 赋值 fogColor', /fogColor=s\.fogColor \? s\.fogColor\.slice\(\)/.test(main));
ok('uniform 绑定 uFogColor(vec3)', /uniform3f\(u\(ptProg,'uFogColor'\)/.test(main));
ok('exportScene 含 fogColor 参数', /rough, jitter, fogColor, fov, bgTop, bgBottom, debugMode, toneMode/.test(main));
ok('UI oninput 绑定 fogColor', /\$\('fogColor'\)\.oninput/.test(main));
ok('index.html 含雾颜色取色器', /id="fogColor"/.test(html));
ok('syncSceneUI 同步 fogColor', /\$\('fogColor'\)\.value = rgb2hex\(fogColor\)/.test(main));

console.log(`\nci105 fogColor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
