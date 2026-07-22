// _oil_test.js — ci297 油画(Oil) 后处理：新能力 + R2(show 着色器末端 NaN/inf 钳制守卫)
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：油画后处理全链路 ----
ok('GLSL 声明 uOil uniform', /uniform float uOil;/.test(main));
ok('show 着色器含油画分支 if(uOil>0.0)', /if\(uOil > 0\.0\)\{[\s\S]*oil = sums\[best\][\s\S]*c = mix\(c, oil, uOil\)/.test(main));
ok('state 声明 oil=0', /let sceneId=0,[\s\S]*\boil=0\b/.test(main));
ok('serializeScene 含 oil(导出链路)', /serializeScene\([\s\S]*\boil\b/.test(main));
ok('deserializeScene 含 oil: num', /oil: num\('oil', 0\)/.test(main));
ok('presetToParams 含 oil: num', /oil: num\(p\.oil, 0\)/.test(main));
ok('applyPreset/importScene 含 oil=s.oil', /oil=s\.oil;/.test(main));
ok('syncSceneUI 恢复 oil 滑块', /\$\('oil'\)\.value = Math\.round\(oil \* 100\)/.test(main));
ok('oninput 接线 oil', /\$\('oil'\)\.oninput/.test(main));
ok('uniform 绑定 uOil', /u\(showProg,'uOil'\)/.test(main));
ok('index.html 含 oil 滑块', /id="oil"/.test(html));

// ---- R2 隐性修复：show 着色器末端 NaN/inf 钳制守卫 ----
ok('show 着色器在 outColor 前钳制 NaN/inf', /c = clamp\(c, 0\.0, 1\.0\);\s*\n\s*outColor = vec4\(c,1\.0\);/.test(main));
ok('clamp 守卫位于 outColor 之前', main.indexOf('c = clamp(c, 0.0, 1.0);') < main.indexOf('outColor = vec4(c,1.0);'));

// ---- 字段数（宽松，兼容后续迭代）----
ok('presetToParams 字段数 >= 80(含 oil)', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return Object.keys(f({})).length >= 80;
})());

// ---- 纯函数行为：油画分箱逻辑端口（JS 复刻，验证“均匀区无笔触变化/边缘取众数桶”）----
function oilPaintJS(neigh, levels) {
  // neigh: 数组的亮度值(0..1)；复刻 GLSL：分箱取众数桶平均
  const sums = new Array(levels).fill(0).map(() => 0);
  const cnts = new Array(levels).fill(0);
  for (const l of neigh) {
    let b = Math.floor(l * levels); if (b < 0) b = 0; if (b > levels - 1) b = levels - 1;
    sums[b] += l; cnts[b] += 1;
  }
  let best = 0, bc = -1;
  for (let i = 0; i < levels; i++) { if (cnts[i] > bc) { bc = cnts[i]; best = i; } }
  return sums[best] / Math.max(cnts[best], 1);
}
const flat = new Array(25).fill(0.5);
ok('均匀邻域油画分箱返回原亮度(无伪笔触)', Math.abs(oilPaintJS(flat, 4) - 0.5) < 1e-9);
const edge = [0.1,0.1,0.1,0.1,0.9,0.9,0.9,0.9]; // 多数为暗
ok('明暗混合邻域取众数桶(暗桶)', oilPaintJS(edge, 4) < 0.5);

console.log(`[Lumen oil] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
