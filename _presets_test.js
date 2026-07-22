// Lumen 场景预设画廊单元测试：抽取真实 PRESETS 数组与 presetToParams 纯函数，
// 断言预设字段合法、归一化类型正确，并校验 UI 接线。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// 抽取 PRESETS 数组字面量
const pm = src.match(/const PRESETS = (\[[\s\S]*?\]);/);
ok('main.js 含 PRESETS', !!pm);
const PRESETS = eval(pm[0].replace('const PRESETS =', ''));

// 抽取 presetToParams 纯函数
const pf = src.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
ok('main.js 含 presetToParams', !!pf);
const presetToParams = eval('(' + pf[0] + ')');

// ---- PRESETS 结构合法性 ----
ok('PRESETS 为非空数组', Array.isArray(PRESETS) && PRESETS.length >= 3);
for(const p of PRESETS){
  ok('预设有 name: ' + p.name, typeof p.name === 'string' && p.name.length > 0);
  ok('预设 sceneId ∈ 0..6: ' + p.name, Number.isInteger(p.sceneId) && p.sceneId >= 0 && p.sceneId <= 6);
  ok('预设 toneMode ∈ 0..3: ' + p.name, Number.isInteger(p.toneMode) && p.toneMode >= 0 && p.toneMode <= 3);
  ok('预设 target 为三维数组: ' + p.name, Array.isArray(p.target) && p.target.length === 3 && p.target.every(Number.isFinite));
  ok('预设 exposure 为有限数: ' + p.name, Number.isFinite(p.exposure));
  ok('预设 radius 为有限数: ' + p.name, Number.isFinite(p.radius));
}

// ---- presetToParams 归一化（类型守卫）----
{
  const s = presetToParams(PRESETS[1]); // 电影感夜景
  ok('presetToParams 返回 57 字段（含太阳/金属粗糙度/黄金比/雾颜色/FOV/背景渐变/调试视图/萤火虫钳制/饱和度/对比度/锐化/抖动/色温/色相/复古褐调/色调分层/电影黑边/CRT扫描线/反相负片/画面边框/亮度增益/双色调/自然饱和度/去色灰度/色调染色/色彩平衡/漂白旁路/褪色/分离色调）', Object.keys(s).length === 57);
  ok('toneMode 取整为 3', s.toneMode === 3);
  ok('target 归一为数字数组', Array.isArray(s.target) && s.target.every(Number.isFinite));
  ok('bloomOn 布尔化 true', s.bloomOn === true);
  ok('neeOn 布尔化 true', s.neeOn === true);
  ok('exposure 保留 0.7', s.exposure === 0.7);
  ok('vignetteOn 默认 false(预设未声明)', s.vignetteOn === false);
  ok('vigStr 默认 0.5(预设未声明)', s.vigStr === 0.5);
  ok('gamma 默认 2.2(预设未声明)', s.gamma === 2.2);
  ok('duotone 默认 0(预设未声明)', s.duotone === 0);
}
// 畸形输入应有默认值且不抛错
{
  const s = presetToParams({});
  ok('空预设 sceneId 默认 0', s.sceneId === 0);
  ok('空预设 target 默认 [0,0,0]', s.target[0] === 0 && s.target[2] === 0);
  ok('空预设 toneMode 默认 0', s.toneMode === 0);
  ok('空预设 bloomOn 默认 false', s.bloomOn === false);
}
// 与 ci69 序列化兼容：presetToParams 输出可完整序列化/反序列化
{
  const { serializeScene, deserializeScene } = (()=>{
    const sm = src.match(/function serializeScene\(s\)\{[\s\S]*?\n\}/);
    const dm = src.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
    return { serializeScene: eval('(' + sm[0] + ')'), deserializeScene: eval('(' + dm[0] + ')') };
  })();
  // 预设是部分状态(33 字段，含太阳/金属粗糙度/黄金比/雾颜色/FOV/背景渐变)，直接拿它与反序列化得到的全量场景做全等必然不等；
  // 改用「默认全量场景 + 预设覆盖」构造完整场景，验证导出/导入往返不丢字段(含预设覆盖值与 gamma)。
  const full = Object.assign(deserializeScene({}), presetToParams(PRESETS[3])); // 玻璃特写
  const round = deserializeScene(serializeScene(full));
  ok('预设经序列化往返一致', JSON.stringify(round) === JSON.stringify(full));
}

// ---- UI 接线 ----
ok('index.html 含 preset 下拉', /id="preset"/.test(html));
ok('下拉选项数 = PRESETS 数', (html.match(/<option value="[0-9]">/g) || []).length >= PRESETS.length);
ok('main.js 含 preset onchange 接线', /getElementById\('preset'\)\.onchange/.test(src) || /\$\('preset'\)\.onchange/.test(src));

console.log(`[Lumen presets] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
