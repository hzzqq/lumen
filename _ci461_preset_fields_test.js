// _ci461_preset_fields_test.js — ci461：presetToParams 字段补漏(隐性修复)
// 根因：applyPreset 读取 s.pointillize/s.pointSize/s.lens/s.lensAmt，但 presetToParams 不输出这些键，
// 导致每次应用预设这 4 个全局变量被写成 undefined；「赛博霓虹」自带的 lens:0.6/lensAmt:-0.35 从未生效。
// 另 grainOn/grainStr 在 serialize/deserialize/import 链路存在，但 preset 链路(presetToParams+applyPreset)整段缺失。
// 本测试含「字段完整性交叉审计」：applyPreset 用到的每个 s.xxx 都必须是 presetToParams 的输出键——防未来再漏。
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'main.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL', n); } };

// brace-count 抽取器（对 CRLF 免疫）
function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括号不配平 ' + name);
}

const ptpSrc = extract('presetToParams');
const presetToParams = eval('(' + ptpSrc + ')');

// ---- R2 修复点：4 个漏出字段现在有输出且带默认值/钳制 ----
const d = presetToParams({});
ok('ci461 pointillize 默认 0', d.pointillize === 0);
ok('ci461 pointSize 默认 0', d.pointSize === 0);
ok('ci461 lens 默认 0', d.lens === 0);
ok('ci461 lensAmt 默认 0.3', d.lensAmt === 0.3);
ok('ci461 grainOn 默认 false', d.grainOn === false);
ok('ci461 grainStr 默认 0.08', d.grainStr === 0.08);

// 显式值透传与钳制
const p = presetToParams({ pointillize: 0.7, pointSize: 2, lens: 0.6, lensAmt: -0.35, grainOn: true, grainStr: 0.2 });
ok('ci461 pointillize=0.7 透传', p.pointillize === 0.7);
ok('ci461 pointSize=2 钳制到 1', p.pointSize === 1);
ok('ci461 lens=0.6 透传（赛博霓虹场景）', p.lens === 0.6);
ok('ci461 lensAmt=-0.35 透传', p.lensAmt === -0.35);
ok('ci461 lensAmt 钳制 [-1,1]', presetToParams({ lensAmt: -5 }).lensAmt === -1);
ok('ci461 grainOn=true 透传', p.grainOn === true && p.grainStr === 0.2);
ok('ci461 pointillize 非法值回默认', presetToParams({ pointillize: 'x' }).pointillize === 0);

// ---- R2 审计：applyPreset 里每个 =s.xxx 都必须是 presetToParams 输出键（防回归的结构性守卫）----
const apStart = src.indexOf('function applyPreset(');
const apSrc = extract('applyPreset');
const used = [...new Set([...apSrc.matchAll(/=s\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))];
const outKeys = new Set(Object.keys(d));
const missing = used.filter(k => !outKeys.has(k));
ok('ci461 审计：applyPreset 所用字段全部在 presetToParams 输出中 ' + (missing.length ? ('缺:' + missing.join(',')) : ''), missing.length === 0);

// ---- 回归：serializeScene 的键（除 v）在 deserializeScene 输出中全存在 ----
const serSrc = extract('serializeScene');
const desFn = eval('(' + extract('deserializeScene') + ')');
const desOut = desFn({});
const serKeys = [...new Set([...serSrc.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]))].filter(k => k !== 'v');
const missDes = serKeys.filter(k => !(k in desOut));
ok('ci461 审计：serialize 键全部可被 deserialize 还原 ' + (missDes.length ? ('缺:' + missDes.join(',')) : ''), missDes.length === 0);

// ---- 回归：validateScene 对合法默认场景仍通过 ----
const validateScene = eval('(' + extract('validateScene') + ')');
const vres = validateScene(desFn({}));
ok('ci461 回归：默认场景 validateScene 通过', vres.ok === true);

console.log(`\n_ci461_preset_fields: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
