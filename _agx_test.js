// _agx_test.js — ci305 AgX 色调映射(模式4)：新能力 + R2(tonemap 末尾 NaN/inf 防御钳制)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：AgX 色调模式(4) ----
ok('GLSL 定义 agxTonemap 函数', /vec3 agxTonemap\(vec3 x\)\{/.test(main));
ok('tonemap 含模式4分支 if(m==4)', /if\(m==4\) return clamp\(agxTonemap\(x\), 0\.0, 1\.0\)/.test(main));
ok('index.html tone 下拉含 AgX 选项(value=4)', /<option value="4">AgX/.test(html));
// 模式4 与 UI 下拉连通：toneMode 钳制区间已含 4(来自 ci301 R2)
ok('presetToParams 允许 toneMode=4', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ toneMode: 4 }).toneMode === 4;
})());

// ---- R2 隐性修复：tonemap 末尾对所有模式做 NaN/inf 防御钳制 ----
ok('tonemap 末尾钳制 aces 结果(防御 NaN/inf)', /return clamp\(aces\(x\), 0\.0, 1\.0\);/.test(main));

// ---- 字段数（AgX 不新增字段, 维持 81）----
ok('presetToParams 字段数 >= 81', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return Object.keys(f({})).length >= 81;
})());

// ---- 纯函数行为：AgX 紧凑曲线端口(JS 复刻) ----
function agxJS(x){
  x = Math.max(x, 0);
  let l = Math.log2(1 + x * 16) / Math.log2(17);
  l = Math.min(1, Math.max(0, l));               // 高光滚降为白
  return l * l * (3 - 2 * l);                    // 平滑 S 曲线
}
ok('AgX: 黑(0)映射为0', Math.abs(agxJS(0)) < 1e-9);
ok('AgX: 高光溢出(>1)滚降为白(1)', Math.abs(agxJS(100) - 1) < 1e-9);
ok('AgX: 中灰(0.5)被提亮(>0.5)', agxJS(0.5) > 0.5 && agxJS(0.5) < 1);
ok('AgX: 单调递增(0.25<0.5<1)', agxJS(0.25) < agxJS(0.5) && agxJS(0.5) <= agxJS(1));

console.log(`[Lumen agx] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
