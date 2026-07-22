// fix_pp_import.js — 复用: 确保指定后处理字段出现在 applyPreset 与 importScene 两行尾(各一次)
// 用法: node fix_pp_import.js <field1> [field2] ...
const fs = require('fs');
const fields = process.argv.slice(2);
if (fields.length === 0) { console.log('no fields given, skip'); process.exit(0); }
let s = fs.readFileSync('main.js', 'utf8').split('\n');

function dedupeStmt(line){
  const t = line.replace(/\s*;\s*$/, '');
  const parts = t.split(';').map(x=>x.trim()).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const p of parts){ const k = p.split('=')[0].trim(); if(seen.has(k)) continue; seen.add(k); out.push(p); }
  return out.join('; ') + ';';
}
function ensureVars(line, vars){
  let l = dedupeStmt(line);
  for (const v of vars){
    if (!new RegExp('\\b' + v + '=s\\.' + v + '\\b').test(l)) l = l.replace(/;\s*$/, '; ' + v + '=s.' + v + ';');
  }
  return l;
}
for (let i = 0; i < s.length - 1; i++){
  const ln = s[i];
  if (!ln.includes('anaglyph=s.anaglyph')) continue;
  const next = s[i+1];
  if (next.includes('syncSceneUI')){
    const before = ln;
    s[i] = ensureVars(ln, fields);
    if (s[i] !== before) console.log((next.startsWith('      ')?'importScene':'applyPreset') + ' 补齐 ' + fields.join(','));
  }
}
fs.writeFileSync('main.js', s.join('\n'));
console.log('ensured fields in both tails:', fields.join(','));
