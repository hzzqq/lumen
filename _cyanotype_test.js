// _cyanotype_test.js — ci329 Lumen 蓝晒(Cyanotype)后处理十步接线验证
// uniform 声明 / GLSL 分支 / 状态默认值 / serialize / deserialize / presetToParams /
// applyPreset+load 两处赋值链 / UI 恢复 / oninput / uniform 绑定 / index.html 滑块
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c)=> { if(c) pass++; else { fail++; console.log('  FAIL:', n); } };

// 1. uniform 声明
ok('uniform float uCyanotype 已声明', /uniform float uCyanotype;/.test(main));
// 2. GLSL 分支
ok('GLSL 存在 uCyanotype 分支', /if\(uCyanotype > 0\.0\)/.test(main));
ok('GLSL 蓝晒三段映射(暗/中/亮)', main.includes('cyDark') && main.includes('cyMid') && main.includes('cyLite'));
ok('GLSL 以 mix(c, cy, uCyanotype) 收尾', main.includes('c = mix(c, cy, uCyanotype);'));
// 3. 状态默认值
ok('state 默认 cyanotype=0', /glitch=0, cyanotype=0, selenium=0;/.test(main));
// 4. serialize
ok('serializeScene 含 cyanotype', /glitch: s\.glitch, cyanotype: s\.cyanotype/.test(main));
// 5. deserialize
ok('deserialize 含 cyanotype 默认0', /cyanotype: num\('cyanotype', 0\)/.test(main));
// 6. presetToParams
ok('presetToParams 含 cyanotype', /cyanotype: num\(p\.cyanotype, 0\)/.test(main));
// 7. 两处赋值链
const assigns = (main.match(/cyanotype=s\.cyanotype;/g) || []).length;
ok('applyPreset/load 两处赋值链 (=2)', assigns === 2);
// 8. UI 恢复
ok('UI 恢复 cyanotype 滑块值', main.includes("if($('cyanotype')) $('cyanotype').value = Math.round(cyanotype * 100);"));
// 9. oninput
ok('oninput 已接线', main.includes("$('cyanotype').oninput"));
// 10. uniform 绑定 + html
ok('uniform1f 绑定 uCyanotype', main.includes("gl.uniform1f(u(showProg,'uCyanotype'), cyanotype);"));
ok('index.html 有 cyanotype 滑块', html.includes('id="cyanotype"') && html.includes('id="cyanotypeVal"'));
ok('index.html 滑块中文标签(蓝晒)', html.includes('蓝晒 Cyanotype'));

// presetToParams 实际执行返回 97 字段
const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
ok('presetToParams 可提取', !!m);
if(m){
  const f = eval('(' + m[0] + ')');
  const keys = Object.keys(f({}));
  ok('presetToParams 返回 97 字段', keys.length === 97);
  ok('字段含 cyanotype 且默认 0', keys.includes('cyanotype') && f({}).cyanotype === 0);
  ok('cyanotype 数值透传', f({ cyanotype: 0.7 }).cyanotype === 0.7);
}

console.log(`cyanotype: ${pass} passed, ${fail} failed`);
if(fail > 0) process.exit(1);
