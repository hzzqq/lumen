// 接线健壮性测试：读取 main.js / index.html 文本，断言 5 个新后处理效果
// (ci397 EdgeDetect / ci401 PosterizeNew / ci405 SepiaNew / ci409 FisheyeNew / ci413 CrossHatch)
// 的 uniform 名、状态字段、十二步接线(声明/分支/状态默认/serialize/deserialize/
//  presetToParams/applyPreset/importScene/exportScene/每帧绑定/syncUI/oninput/UI 控件)
// 以及 GLSL 分支真实引用了对应 uniform。同时运行 `node --check` 确保语法 0 错误，
// 并统计 serializeScene 字段数(应 > 121)。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE = process.execPath;
const DIR = __dirname;
const mainPath = path.join(DIR, 'main.js');
const htmlPath = path.join(DIR, 'index.html');

const main = fs.readFileSync(mainPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

let failures = [];
function need(fileText, fileLabel, sub) {
  if (!fileText.includes(sub)) failures.push(`[${fileLabel}] 缺失接线关键词: ${sub}`);
}

// 每个 cycle：(cycle, uniform, 状态字段, 默认值 token 组合, 分支真实使用片段)
const effects = [
  { cycle: 'ci397', uniform: 'uEdgeDetect',  field: 'edgeDetect',  def: 'edgeDetect=0,',
    use: 'c = mix(c, vec3(clamp(mag * 6.0, 0.0, 1.0)), uEdgeDetect);' },
  { cycle: 'ci401', uniform: 'uPosterizeNew', field: 'posterizeNew', def: 'posterizeNew=0,',
    use: 'clamp(uPosterizeNew, 0.0, 1.0)' },
  { cycle: 'ci405', uniform: 'uSepiaNew',    field: 'sepiaNew',    def: 'sepiaNew=0,',
    use: 'c = clamp(mix(c, sep, uSepiaNew), 0.0, 1.0);' },
  { cycle: 'ci409', uniform: 'uFisheyeNew',  field: 'fisheyeNew',  def: 'fisheyeNew=0,',
    use: 'c = mix(c, fz, uFisheyeNew);' },
  { cycle: 'ci413', uniform: 'uCrossHatch',  field: 'crossHatch',  def: 'crossHatch=0;',
    use: 'c = mix(c, hc, uCrossHatch);' },
];

for (const e of effects) {
  need(main, e.cycle, `uniform float ${e.uniform};`);                    // 第1步 GLSL 声明
  need(main, e.cycle, `if(${e.uniform} > 0.0){`);                        // 第2步 SHOW 分支入口
  need(main, e.cycle, e.use);                                            // 第2步 分支真实使用该 uniform
  need(main, e.cycle, e.def);                                            // 第3步 状态默认值
  need(main, e.cycle, `${e.field}: s.${e.field}`);                       // 第4步 serializeScene
  need(main, e.cycle, `${e.field}: Math.max(0, Math.min(1, num('${e.field}', 0)))`); // 第5步 deserialize 钳制
  need(main, e.cycle, `${e.field}: num(p.${e.field}, 0)`);               // 第6步 presetToParams
  need(main, e.cycle, `${e.field}=s.${e.field}`);                        // 第7/8步 applyPreset / importScene
  // 第8步 exportScene：crossHatch 紧贴 });，其余字段以 ", field," 形式出现在 export 列表中
  if (e.field === 'crossHatch') need(main, e.cycle, `, ${e.field} });`);
  else need(main, e.cycle, `, ${e.field},`);
  need(main, e.cycle, `if($('${e.field}')) $('${e.field}').value`);      // 第11步 syncUI 回写
  need(main, e.cycle, `$('${e.field}').oninput`);                        // 第12步 oninput 写回
  need(main, e.cycle, `u(showProg,'${e.uniform}')`);                     // 第9步 每帧 uniform 绑定
  need(html, e.cycle, `id="${e.field}"`);                                // 第10步 UI 控件
}

// 额外守卫：既有 uEdge 的 GLSL 白化钳制(ci405 隐性修复)确实存在，避免高边缘过曝
need(main, 'ci405', 'c = mix(c, vec3(clamp(mag * uEdge * 8.0, 0.0, 1.0)), uEdge);');
// denIters oninput 已加 NaN/范围守卫(ci409 隐性修复)
need(main, 'ci409', "let dv=+e.target.value; if(!isFinite(dv)) dv=3; dv=Math.max(1,Math.min(5,dv)); denIters=Math.round(dv);");
// glitch oninput 已加 NaN/范围守卫(ci413 隐性修复)
need(main, 'ci413', "let gv=+e.target.value/100; if(!isFinite(gv)) gv=0; gv=Math.max(0,Math.min(1,gv)); glitch=gv;");
// 终末 NaN/inf 钳制守卫仍在
need(main, 'common', 'outColor = vec4(clamp(c, 0.0, 1.0), 1.0)');

// ---- 语法检查：node --check 必须 0 错误 ----
try {
  execSync(`"${NODE}" --check "${mainPath}"`, { cwd: DIR, stdio: 'pipe' });
  console.log('node --check main.js : PASS (0 errors)');
} catch (e) {
  failures.push('node --check main.js 失败: ' + (e.stderr ? e.stderr.toString() : e.message));
}

// ---- 字段数统计（serializeScene 中的字段数，应 > 121）----
const m = main.match(/function serializeScene[\s\S]*?return\s*\{([\s\S]*?)\n\s*\};/);
let fieldCount = 0;
if (m) {
  const body = m[1];
  fieldCount = (body.match(/:\s*s\./g) || []).length;
  console.log('serializeScene 字段数(≈总后处理/渲染字段数): ' + fieldCount);
} else {
  failures.push('无法定位 serializeScene 字段数');
}
if (fieldCount <= 121) failures.push('字段数未增长(应 > 121), 实际 ' + fieldCount);

// ---- 汇总 ----
if (failures.length === 0) {
  console.log('\nALL_CHECKS_PASS ✅  5 个效果(EdgeDetect/PosterizeNew/SepiaNew/FisheyeNew/CrossHatch)接线全部到位');
  process.exit(0);
} else {
  console.log('\nCHECK_FAILURES ❌ (' + failures.length + ')');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
