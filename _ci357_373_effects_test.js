// 接线健壮性测试：读取 main.js / index.html 文本，断言 5 个新后处理效果
// (ci357 Watercolor / ci361 Pixelate+uPixelSize / ci365 HueShift /
//  ci369 Duotone 配色 / ci373 ChromaticAberration+uChromaAmt)
// 的 uniform 名、状态字段、serialize/deserialize/presetToParams/applyPreset、
// 每帧 uniform 绑定、UI 控件、syncUI、oninput 等关键接线均已落地。
// 同时运行 `node --check` 确保语法 0 错误。
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

// ---- ci357 Watercolor ----
need(main, 'main', 'uniform float uWatercolor');
need(main, 'main', 'watercolor=0');
need(main, 'main', "gl.uniform1f(u(showProg,'uWatercolor')");
need(main, 'main', 'watercolor: s.watercolor');        // serializeScene
need(main, 'main', "watercolor: Math.max(0, Math.min(1, num('watercolor'");     // deserializeScene(含 [0,1] 钳制守卫)
need(main, 'main', "watercolor: Math.max(0, Math.min(1, num(p.watercolor");    // presetToParams(含 [0,1] 钳制守卫)
need(main, 'main', 'watercolor=s.watercolor');          // applyPreset / importScene
need(main, 'main', "$('watercolor').oninput");
need(html, 'html', 'id="watercolor"');

// ---- ci361 Pixelate + uPixelSize ----
need(main, 'main', 'uniform float uPixelSize');
need(main, 'main', 'pixelSize=0');
need(main, 'main', "gl.uniform1f(u(showProg,'uPixelSize')");
need(main, 'main', 'pixelSize: s.pixelSize');
need(main, 'main', "pixelSize: Math.max(0, Math.min(1, num('pixelSize'");
need(main, 'main', "pixelSize: Math.max(0, Math.min(1, num(p.pixelSize");
need(main, 'main', 'pixelSize=s.pixelSize');
need(main, 'main', "$('pixelSize').oninput");
need(html, 'html', 'id="pixelSize"');
need(main, 'main', 'uPixelSize');                       // 在 SHOW 着色器分支中被引用

// ---- ci365 HueShift ----
need(main, 'main', 'uniform float uHueShift');
need(main, 'main', 'hueShift=0');
need(main, 'main', "gl.uniform1f(u(showProg,'uHueShift')");
need(main, 'main', 'hueShift: s.hueShift');
need(main, 'main', "hueShift: Math.max(-180, Math.min(180, num('hueShift'");
need(main, 'main', "hueShift: Math.max(-180, Math.min(180, num(p.hueShift");
need(main, 'main', 'hueShift=s.hueShift');
need(main, 'main', "$('hueShift').oninput");
need(html, 'html', 'id="hueShift"');

// ---- ci369 Duotone 配色 (uDuotoneShadow / uDuotoneHigh) ----
need(main, 'main', 'uDuotoneShadow');                   // GLSL 声明 + 引用
need(main, 'main', 'uDuotoneHigh');
need(main, 'main', "gl.uniform3f(u(showProg,'uDuotoneShadow')");
need(main, 'main', "gl.uniform3f(u(showProg,'uDuotoneHigh')");
need(main, 'main', 'duotoneShadow=[');                  // 状态默认值
need(main, 'main', 'duotoneShadow: s.duotoneShadow');  // serializeScene
need(main, 'main', 'duotoneShadow: fin3(');            // deserialize / presetToParams
need(main, 'main', 'duotoneShadow=s.duotoneShadow.slice()'); // applyPreset / importScene
need(main, 'main', "$('duotoneShadow').oninput");
need(html, 'html', 'id="duotoneShadow"');
need(html, 'html', 'id="duotoneHigh"');

// ---- ci373 ChromaticAberration + uChromaAmt ----
need(main, 'main', 'uniform float uChromaAmt');
need(main, 'main', 'chromaAmt=0.5');
need(main, 'main', "gl.uniform1f(u(showProg,'uChromaAmt')");
need(main, 'main', 'chromaAmt: s.chromaAmt');
need(main, 'main', 'chromaAmt: Math.max');              // deserialize 钳制守卫
need(main, 'main', "chromaAmt: Math.max(0, Math.min(1, num(p.chromaAmt"); // presetToParams(含钳制)
need(main, 'main', 'chromaAmt=s.chromaAmt');
need(main, 'main', "$('chromaAmt').oninput");
need(main, 'main', "chromaOn: bool(p.chromaOn)");      // 修复 presetToParams 遗漏 chroma 的隐性 bug
need(html, 'html', 'id="chromaAmt"');

// ---- 附加守卫：gamma / temp / duotone 钳制 ----
need(main, 'main', 'gamma: Math.max(0.1, Math.min(5.0');   // 防 pow(c,1/gamma) 除零 NaN
need(main, 'main', 'temp: Math.max(-1, Math.min(1');
need(main, 'main', 'duotone: Math.max(0, Math.min(1');

// ---- 语法检查：node --check 必须 0 错误 ----
try {
  execSync(`"${NODE}" --check "${mainPath}"`, { cwd: DIR, stdio: 'pipe' });
  console.log('node --check main.js : PASS (0 errors)');
} catch (e) {
  failures.push('node --check main.js 失败: ' + (e.stderr ? e.stderr.toString() : e.message));
}

// ---- 字段数统计（serializeScene 中的字段数）----
const m = main.match(/function serializeScene[\s\S]*?return\s*\{([\s\S]*?)\n\s*\};/);
let fieldCount = 0;
if (m) {
  const body = m[1];
  fieldCount = (body.match(/:\s*s\./g) || []).length;
  console.log('serializeScene 字段数(≈总后处理/渲染字段数): ' + fieldCount);
} else {
  failures.push('无法定位 serializeScene 字段数');
}

// ---- 汇总 ----
if (failures.length === 0) {
  console.log('\nALL_CHECKS_PASS ✅  5 个效果接线全部到位');
  process.exit(0);
} else {
  console.log('\nCHECK_FAILURES ❌ (' + failures.length + ')');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
