// ci426 — Lumen 新增「深海蓝调」色调预设 + presetToParams 防御性下限钳制(R2: 防 focusDist/radius/resScale 为 0 导致着色 NaN)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + n); } };

const pm = main.match(/const PRESETS = \[[\s\S]*?\n\];/);
const PRESETS = eval('(' + pm[0].replace('const PRESETS =', '').replace(/;\s*$/, '') + ')');
const fm = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
const presetToParams = eval('(' + fm[0] + ')');

// ---------- R1：深海蓝调 预设 ----------
const idx = PRESETS.findIndex(p => p.name === '深海蓝调');
ok('ci426 预设「深海蓝调」存在', idx >= 0);
ok('ci426 预设位于下拉索引 9', idx === 9);
if (idx >= 0) {
  const s = presetToParams(PRESETS[idx]);
  ok('ci426 归一化 125 字段', Object.keys(s).length === 125);
  ok('ci426 duotoneHigh 蓝调 [0.2,0.6,0.9]', Array.isArray(s.duotoneHigh) && s.duotoneHigh[0] === 0.2 && s.duotoneHigh[1] === 0.6 && s.duotoneHigh[2] === 0.9);
  ok('ci426 fogDensity=0.15', s.fogDensity === 0.15);
  ok('ci426 vignetteOn=true', s.vignetteOn === true);
  ok('index.html 含 <option value="9">深海蓝调', html.includes('<option value="9">深海蓝调</option>'));
}

// ---------- R2：防御性下限钳制(防 0/负 -> 着色 NaN) ----------
{
  const z = presetToParams({ focusDist: 0, radius: 0, resScale: 0, exposure: -5 });
  ok('R2 focusDist 防 0/负 (有限且 >0)', Number.isFinite(z.focusDist) && z.focusDist > 0);
  ok('R2 radius 防 0/负 (有限且 >0)', Number.isFinite(z.radius) && z.radius > 0);
  ok('R2 resScale 防 0/负 (有限且 >0)', Number.isFinite(z.resScale) && z.resScale > 0);
  ok('R2 exposure 下限 0 (防负)', z.exposure >= 0);
}
// 正常预设不受影响
{
  const a = presetToParams(PRESETS.find(p => p.name === '深海蓝调'));
  ok('R2 正常预设 focusDist 保持 13', a.focusDist === 13);
  ok('R2 正常预设 radius 保持 14', a.radius === 14);
}

console.log(`\n[Lumen ci426 preset] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
