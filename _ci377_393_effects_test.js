// 接线健壮性测试：读取 main.js / index.html 文本，断言 5 个新后处理效果
// (ci377 Bloom/uBloomThreshold / ci381 Glow/uGlowThreshold / ci385 FilmGrain/uGrainAmount /
//  ci389 Scanlines/uScanlines / ci393 ColorGrade/uColorGrade+uSaturation+uGradeContrast)
// 的 uniform 名、状态字段、serialize/deserialize/presetToParams/applyPreset、
// 每帧 uniform 绑定、UI 控件、syncUI、oninput 等关键接线均已落地。
// 同时运行 `node --check` 确保语法 0 错误，并统计 serializeScene 字段数(应 > 111)。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const DIR = __dirname;
const mainPath = path.join(DIR, 'main.js');
const htmlPath = path.join(DIR, 'index.html');

const main = fs.readFileSync(mainPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

let failures = [];
function need(fileText, fileLabel, sub) {
  if (!fileText.includes(sub)) failures.push(`[${fileLabel}] 缺失接线关键词: ${sub}`);
}

// 每个 cycle 的 (uniform, 状态字段, 默认值 token)
const effects = [
  { cycle: 'ci377', uniform: 'uBloomThreshold', field: 'bloomThreshold', def: 'bloomThreshold=0.0' },
  { cycle: 'ci381', uniform: 'uGlowThreshold',  field: 'glowThreshold',  def: 'glowThreshold=0.0' },
  { cycle: 'ci385', uniform: 'uGrainAmount',    field: 'grainAmount',    def: 'grainAmount=1.0' },
  { cycle: 'ci389', uniform: 'uScanlines',      field: 'scanlines',      def: 'scanlines=0,' },
  { cycle: 'ci393', uniform: 'uColorGrade',     field: 'colorGrade',     def: 'colorGrade=0,' },
  { cycle: 'ci393', uniform: 'uSaturation',     field: 'saturation',     def: 'saturation=1,' },
  { cycle: 'ci393', uniform: 'uGradeContrast',  field: 'gradeContrast',  def: 'gradeContrast=1;' },
];

for (const e of effects) {
  need(main, e.cycle, `uniform float ${e.uniform};`);          // GLSL 声明(第1步)
  need(main, e.cycle, e.def);                                  // 状态默认值(第3步)
  need(main, e.cycle, `${e.field}: s.${e.field}`);            // serializeScene(第4步)
  need(main, e.cycle, `${e.field}: Math.max`);                // deserializeScene 钳制守卫(第5步)
  need(main, e.cycle, `${e.field}: num(p.`);                  // presetToParams(第6/7步)
  need(main, e.cycle, `${e.field}=s.${e.field}`);             // applyPreset / importScene(第7/8步)
  need(main, e.cycle, `u(showProg,'${e.uniform}')`);          // 每帧 uniform 绑定(第9步)
  need(main, e.cycle, `$('${e.field}').oninput`);             // oninput 写回状态(第12步)
  need(html, e.cycle, `id="${e.field}"`);                     // UI 控件(第10步)
}

// 额外守卫：关键 uniform 确实在 SHOW 分支被引用(GLSL 第2步落地)
need(main, 'ci377', 'thr = (uBloomThreshold > 0.0)');         // bloom 分支引用 uBloomThreshold
need(main, 'ci381', 'gthr = (uGlowThreshold > 0.0)');         // glow 分支引用 uGlowThreshold
need(main, 'ci385', '* uGrainAmount');                        // grain 分支引用 uGrainAmount
need(main, 'ci389', 'uScanlines > 0.0');                     // scanlines 分支
need(main, 'ci393', 'uColorGrade > 0.0');                    // colorGrade 分支
need(main, 'ci393', 'uSaturation');                          // 调色饱和度引用
need(main, 'ci393', 'uGradeContrast');                       // 调色对比度引用
// 终末 NaN/inf 钳制守卫(ci377 隐性修复)
need(main, 'ci377', 'outColor = vec4(clamp(c, 0.0, 1.0), 1.0)');

// ---- 语法检查：node --check 必须 0 错误 ----
try {
  execSync(`"${NODE}" --check "${mainPath}"`, { cwd: DIR, stdio: 'pipe' });
  console.log('node --check main.js : PASS (0 errors)');
} catch (e) {
  failures.push('node --check main.js 失败: ' + (e.stderr ? e.stderr.toString() : e.message));
}

// ---- 字段数统计（serializeScene 中的字段数，应 > 111）----
const m = main.match(/function serializeScene[\s\S]*?return\s*\{([\s\S]*?)\n\s*\};/);
let fieldCount = 0;
if (m) {
  const body = m[1];
  fieldCount = (body.match(/:\s*s\./g) || []).length;
  console.log('serializeScene 字段数(≈总后处理/渲染字段数): ' + fieldCount);
} else {
  failures.push('无法定位 serializeScene 字段数');
}
if (fieldCount <= 111) failures.push('字段数未增长(应 > 111), 实际 ' + fieldCount);

// ---- 汇总 ----
if (failures.length === 0) {
  console.log('\nALL_CHECKS_PASS ✅  5 个效果(Bloom/Glow/FilmGrain/Scanlines/ColorGrade)接线全部到位');
  process.exit(0);
} else {
  console.log('\nCHECK_FAILURES ❌ (' + failures.length + ')');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
