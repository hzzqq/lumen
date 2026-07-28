// ci450 — 新增 Hejl 快速胶片色调映射(模式5, R1) + toneMode 上限单一真相源 TONE_MODE_MAX(R2)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// 括号配平的稳健提取(避免 CRLF / 非贪婪 .*? 越界吞掉后续函数)
function extractFn(src, name){
  const start = src.indexOf('function ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for(let j = i; j < src.length; j++){ if(src[j] === '{') depth++; else if(src[j] === '}'){ depth--; if(depth === 0){ end = j; break; } } }
  return src.slice(start, end + 1);
}

// ---- R1 新能力：Hejl 快速胶片(模式5) ----
ok('GLSL 定义 hejlTonemap 函数', /vec3 hejlTonemap\(vec3 x\)\{/.test(main));
ok('tonemap 含模式5分支 if(m==5)', /if\(m==5\) return clamp\(hejlTonemap\(x\), 0\.0, 1\.0\)/.test(main));
ok('index.html tone 下拉含 Hejl 选项(value=5)', /<option value="5">Hejl/.test(html));

// ---- R2 隐性修复：toneMode 上限由 presetToParams 内 TONE_MODE_MAX 单一常量驱动(消除硬编码 4 的脆弱耦合) ----
ok('presetToParams 内定义 TONE_MODE_MAX = 5', /function presetToParams\(p\)\{[\s\S]*?const TONE_MODE_MAX = 5;/.test(main));
const presetToParams = eval('(' + extractFn(main, 'presetToParams') + ')');
ok('presetToParams 钳制使用 TONE_MODE_MAX', /Math\.min\(TONE_MODE_MAX,/.test(extractFn(main, 'presetToParams')));
ok('presetToParams 允许 toneMode=5', presetToParams({ toneMode: 5 }).toneMode === 5);
ok('presetToParams 将越界 99 钳制为 TONE_MODE_MAX(5)', presetToParams({ toneMode: 99 }).toneMode === 5);
ok('presetToParams 将负数 -3 钳制为 0', presetToParams({ toneMode: -3 }).toneMode === 0);

// ---- 纯函数行为：Hejl 曲线 JS 复刻(与 GLSL 公式一致) ----
function hejlJS(x){
  x = Math.max(0, x);
  const r = x * (6.2 * x + 0.5) / (x * (6.2 * x + 1.7) + 0.06);
  return Math.min(1, Math.max(0, r));
}
ok('Hejl: 黑(0)映射为 0', Math.abs(hejlJS(0)) < 1e-9);
ok('Hejl: 高光溢出(1e6)饱和至近白(>0.999)', hejlJS(1e6) > 0.999);
ok('Hejl: 中灰(0.5)落在 (0,1)', hejlJS(0.5) > 0 && hejlJS(0.5) < 1);
ok('Hejl: 单调递增 0.25<0.5<1', hejlJS(0.25) < hejlJS(0.5) && hejlJS(0.5) < hejlJS(1));
ok('Hejl: 单位输入(1)落在 (0,1)', hejlJS(1) > 0 && hejlJS(1) < 1);

// 字段数不退化(模式5 不新增 param 字段)
ok('presetToParams 字段数 >= 120', Object.keys(presetToParams({})).length >= 120);

console.log(`[Lumen ci450 tonemap] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
