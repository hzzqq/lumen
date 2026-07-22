// _lomo_test.js — ci301 Lomo 后处理：新能力 + R2(presetToParams/deserializeScene 钳制 toneMode 到 [0,4])
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：Lomo 后处理全链路 ----
ok('GLSL 声明 uLomo uniform', /uniform float uLomo;/.test(main));
ok('show 着色器含 Lomo 分支 if(uLomo>0.0)', /if\(uLomo > 0\.0\)\{[\s\S]*shadowTint[\s\S]*highTint[\s\S]*c = mix\(vec3\(g\), c, sat\)/.test(main));
ok('state 声明 lomo=0', /let sceneId=0,[\s\S]*\blomo=0\b/.test(main));
ok('serializeScene 含 lomo(导出链路)', /serializeScene\([\s\S]*\blomo\b/.test(main));
ok('deserializeScene 含 lomo: num', /lomo: num\('lomo', 0\)/.test(main));
ok('presetToParams 含 lomo: num', /lomo: num\(p\.lomo, 0\)/.test(main));
ok('applyPreset/importScene 含 lomo=s.lomo', /lomo=s\.lomo;/.test(main));
ok('syncSceneUI 恢复 lomo 滑块', /\$\('lomo'\)\.value = Math\.round\(lomo \* 100\)/.test(main));
ok('oninput 接线 lomo', /\$\('lomo'\)\.oninput/.test(main));
ok('uniform 绑定 uLomo', /u\(showProg,'uLomo'\)/.test(main));
ok('index.html 含 lomo 滑块', /id="lomo"/.test(html));

// ---- R2 隐性修复：toneMode 钳制到合法范围 [0,4]（防越界/负数模式）----
ok('presetToParams 钳制 toneMode 上界(99->4)', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ toneMode: 99 }).toneMode === 4;
})());
ok('presetToParams 钳制 toneMode 下界(-5->0)', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ toneMode: -5 }).toneMode === 0;
})());
ok('deserializeScene 钳制 toneMode 上界(99->4)', (() => {
  const m = main.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ toneMode: 99 }).toneMode === 4;
})());

// ---- 字段数（宽松, 兼容后续迭代）----
ok('presetToParams 字段数 >= 81(含 lomo)', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return Object.keys(f({})).length >= 81;
})());

// ---- 纯函数行为：Lomo 暗角 + 冷暖色偏端口（JS 复刻, 验证边缘压暗/饱和度提升）----
function lomoJS(c, q, strength){
  // c: [r,g,b]; q: 到中心距离(0..~0.7); 复刻 GLSL
  let vig = Math.max(0, Math.min(1, (0.85 - (q*1.3)) / (0.85 - 0.15)));
  vig = vig * vig * (3 - 2 * vig); // smoothstep 近似
  for (let i=0;i<3;i++) c[i] *= (1 + (vig - 1) * strength);
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const sh = [0.90,0.96,1.06], hi = [1.06,0.98,0.88];
  for (let i=0;i<3;i++) c[i] *= (sh[i] + (hi[i]-sh[i]) * l);
  const sat = 1 + 0.45 * strength;
  const g = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  for (let i=0;i<3;i++) c[i] = g + (c[i]-g)*sat;
  return c;
}
const center = lomoJS([0.5,0.5,0.5], 0.0, 1.0);
const edge = lomoJS([0.5,0.5,0.5], 0.3, 1.0);
ok('Lomo 边缘像素被暗角压暗(边缘<中心亮度)', (edge[0]+edge[1]+edge[2]) < (center[0]+center[1]+center[2]));
const inC = [0.8,0.4,0.6];
const spreadBefore = Math.abs(inC[0]-inC[1]) + Math.abs(inC[1]-inC[2]);
const outC = lomoJS(inC.slice(), 0.0, 1.0); // 中心 vig=1 不受暗角, 仅看色偏+饱和
const spreadAfter = Math.abs(outC[0]-outC[1]) + Math.abs(outC[1]-outC[2]);
ok('Lomo 提饱和(中心彩色像素通道离散度增大)', spreadAfter > spreadBefore);

console.log(`[Lumen lomo] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
