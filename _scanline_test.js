// ci161 Lumen CRT 扫描线(Scanline) —— 忠实移植 uScanline 的纵向周期压暗(基于 vUv.y) + 源码接线检查
'use strict';
const fs = require('fs');
const path = require('path');

// 忠实移植 main.js 的扫描线因子：lines 固定=320，s = 0.5+0.5*sin(y*lines*PI) ∈[0,1]
function scanlineFactor(y, lines){
  const L = (lines == null) ? 320.0 : lines;
  return 0.5 + 0.5 * Math.sin(y * L * Math.PI);
}
// 应用扫描线：c *= mix(1, s, strength) = c * (1 - strength + strength*s)
function applyScanline(c, strength, y, lines){
  const s = scanlineFactor(y, lines);
  return c * (1 - strength + strength * s);
}

let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

// 1. 关闭时(strength=0)恒等：任意 y 不改变颜色
ok('strength=0 恒等(亮线)', applyScanline(0.8, 0, 0.0015625) === 0.8);
ok('strength=0 恒等(暗线)', applyScanline(0.8, 0, 0.0046875) === 0.8);

// 2. 亮线(y 处 sin=1, s=1)：matched 不变；暗线(y 处 sin=-1, s=0)：按 (1-strength) 压暗
const yBright = 0.5 / 320;   // sin(y*320*PI)=sin(PI/2)=1
const yDark   = 1.5 / 320;   // sin(y*320*PI)=sin(3PI/2)=-1
ok('亮线 s=1 时 strength=1 颜色不变', Math.abs(applyScanline(0.8, 1, yBright) - 0.8) < 1e-12);
ok('暗线 s=0 时 strength=1 变黑(0)', Math.abs(applyScanline(0.8, 1, yDark) - 0.0) < 1e-12);
ok('暗线 s=0 时 strength=0.5 减半', Math.abs(applyScanline(0.8, 0.5, yDark) - 0.4) < 1e-12);
ok('暗线 s=0 时 strength=0.2 → 0.8*c', Math.abs(applyScanline(1.0, 0.2, yDark) - 0.8) < 1e-12);

// 3. 单调：固定暗线，strength 越大越暗
ok('strength 越大越暗(单调)', applyScanline(1.0, 0.2, yDark) > applyScanline(1.0, 0.8, yDark));
ok('strength 越大越暗(强vs弱)', applyScanline(0.9, 0.1, yDark) > applyScanline(0.9, 0.9, yDark));

// 4. 上限：扫描线只压暗不增亮，产物 ∈ [0, c]
ok('扫描线不改亮(strength=1 亮线仍=原值)', Math.abs(applyScanline(0.5, 1, yBright) - 0.5) < 1e-12);
ok('产物不小于 0', applyScanline(0.7, 1, yDark) >= 0);
ok('产物不大于原值', applyScanline(0.7, 0.3, 0.0025) <= 0.7 + 1e-12);

// 5. 因子范围：s ∈ [0,1]（由 0.5±0.5*sin 构造），用精确极值点验证下界/上界
ok('扫描线因子 s 下界=0(暗线 sin=-1)', Math.abs(scanlineFactor(yDark, 320) - 0) < 1e-12);
ok('扫描线因子 s 上界=1(亮线 sin=1)', Math.abs(scanlineFactor(yBright, 320) - 1) < 1e-12);
ok('扫描线因子恒非负(s>=0)', scanlineFactor(0.25, 320) >= 0 && scanlineFactor(0.75, 320) >= 0);
ok('扫描线因子恒<=1(s<=1)', scanlineFactor(0.25, 320) <= 1 + 1e-12 && scanlineFactor(0.75, 320) <= 1 + 1e-12);

// ---- 源码接线检查 ----
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

ok('GLSL 声明 uniform float uScanline', /uniform float uScanline;/.test(main));
ok('GLSL 链路含 uScanline>0 分支', /if\(uScanline > 0\.0\)/.test(main));
ok('GLSL 使用 mix(1.0, s, uScanline)', /mix\(1\.0, s, uScanline\)/.test(main));
ok('state 默认含 scanline=0', /scanline=0[,;]/.test(main));
ok('serialize 含 scanline: s.scanline', /scanline: s\.scanline/.test(main));
ok('deserialize 含 scanline: num', /scanline: num\('scanline', 0\)/.test(main));
ok('presetToParams 含 scanline', /scanline: num\(p\.scanline, 0\)/.test(main));
ok('applyPreset 含 scanline=s.scanline', /scanline=s\.scanline;/.test(main));
ok('syncSceneUI 含 scanline 滑块同步', /\$\('scanline'\)\.value = Math\.round\(scanline \* 100\)/.test(main));
ok('exportScene 含 letterbox, scanline', /letterbox, scanline/.test(main));
ok('uniform 绑定 uScanline', /u\(showProg,'uScanline'\)/.test(main));
ok('UI oninput 接线 scanline', /\$\('scanline'\)\.oninput/.test(main));
ok('index.html 含 scanline 滑块', /id="scanline"/.test(html));

console.log(`[Lumen scanline] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
