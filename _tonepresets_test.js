// _tonepresets_test.js — ci341/ci345/ci349/ci353 四个色调预设：月夜极光/铜绿古董/玫瑰暖调/琥珀余晖
// 校验 PRESETS 新条目存在、字段合法、presetToParams 归一化正确、index.html 下拉同步。
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.error('  FAIL: ' + name); } }

// 提取生产 PRESETS 与 presetToParams
const pm = main.match(/const PRESETS = \[[\s\S]*?\n\];/);
ok('可提取 PRESETS', !!pm);
const PRESETS = eval('(' + pm[0].replace('const PRESETS =', '').replace(/;\s*$/, '') + ')');
const fm = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
const presetToParams = eval('(' + fm[0] + ')');

const WANT = [
  { name: '月夜极光', ci: 'ci341', fields: { moonlight: 0.55, aurora: 0.4 } },
  { name: '铜绿古董', ci: 'ci345', fields: { verdigris: 0.6, fade: 0.25 } },
  { name: '玫瑰暖调', ci: 'ci349', fields: { rosegold: 0.5, glow: 0.2, vibrance: 0.3 } },
  { name: '琥珀余晖', ci: 'ci353', fields: { amber: 0.65, temp: 0.15 } },
];

ok('PRESETS 共 9 个（5 旧 + 4 新色调预设）', PRESETS.length === 9);

for(const w of WANT){
  const idx = PRESETS.findIndex(p => p.name === w.name);
  ok(`${w.ci} 预设「${w.name}」存在`, idx >= 0);
  if(idx < 0) continue;
  const s = presetToParams(PRESETS[idx]);
  ok(`「${w.name}」归一化后 102 字段`, Object.keys(s).length === 102);
  for(const [k, v] of Object.entries(w.fields)){
    ok(`「${w.name}」${k}=${v}`, s[k] === v);
  }
  // 效果强度必须在 (0,1] 内
  for(const k of ['moonlight','verdigris','rosegold','aurora','amber']){
    ok(`「${w.name}」${k} 合法范围 [0,1]`, s[k] >= 0 && s[k] <= 1);
  }
  // 基本参数健全
  ok(`「${w.name}」exposure 有限且 > 0`, Number.isFinite(s.exposure) && s.exposure > 0);
  ok(`「${w.name}」toneMode 在 0..4`, s.toneMode >= 0 && s.toneMode <= 4);
  // index.html 下拉含该预设（value = 索引）
  ok(`index.html 含 <option value="${idx}">${w.name}`, html.includes(`<option value="${idx}">${w.name}</option>`));
}

// 互不污染：月夜极光不应带 amber，琥珀余晖不应带 moonlight
{
  const moon = presetToParams(PRESETS.find(p => p.name === '月夜极光'));
  const amber = presetToParams(PRESETS.find(p => p.name === '琥珀余晖'));
  ok('月夜极光 amber=0', moon.amber === 0);
  ok('琥珀余晖 moonlight=0', amber.moonlight === 0);
}

console.log(`\n[Lumen tonepresets] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
