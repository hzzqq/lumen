// _ci456_scene_roundtrip_test.js — 验证 ci456：场景 save/load 往返真实保留
// LensDistortion(lens/lensAmt) 与 萤火虫钳制(clampRad) 此前在反序列化与导入处理器中
// 双重缺失，导致保存后再导入这些设置被静默丢弃（隐性数据丢失，自 c428/c450 起）。
// 本测试抽取 main.js 中真实的 serializeScene/deserializeScene（大括号配对），
// 跑真实往返，而非仅测数学；并校验导入处理器已接线。
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// --- 从 main.js 抽取真实函数体（大括号配对，忽略字符串内的括号） ---
function extractFn(name){
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if(start < 0) throw new Error('cannot find ' + name);
  let i = src.indexOf('{', start), depth = 0, inStr = null;
  for(; i < src.length; i++){
    const c = src[i];
    if(inStr){ if(c === inStr && src[i-1] !== '\\') inStr = null; continue; }
    if(c === '"' || c === "'"){ inStr = c; continue; }
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const serSrc = extractFn('serializeScene');
const desSrc = extractFn('deserializeScene');
// 在含 TONE_MODE_MAX 的作用域内求值真实函数
const factory = new Function('TONE_MODE_MAX', serSrc + '\n' + desSrc + '\nreturn { serializeScene, deserializeScene };');
const { serializeScene, deserializeScene } = factory(5);

// --- 1. 真实往返保留镜头畸变 / 钳制 / Hejl 色调映射 ---
const scene = {
  sceneId: 5, theta: 1, phi: 0.2, radius: 14, target: [0,0,0], maxBounces: 8, resScale: 1,
  exposure: 1.05, focusDist: 13, aperture: 0, maxSamples: 2400, toneMode: 5, // Hejl(=TONE_MODE_MAX)
  autoExp: false, fogDensity: 0, rrOn: false, denoiseOn: false, denIters: 3, neeOn: true,
  envInt: 0.9, bloomOn: true, bloomStr: 0.7, bloomThr: 0.8,
  lens: 0.6, lensAmt: -0.35, clampRad: 3,
  chromaOn: true, chromaStr: 0.5,
  gamma: 2.2, satStr: 1, contrast: 1, sharpen: 0, dither: 0, temp: 0, hue: 0, sepia: 0,
  bgTop: [0.20,0.36,0.66], bgBottom: [0.62,0.70,0.80], fogColor: [0.8,0.85,0.9],
  duotoneShadow: [0.05,0.0,0.1], duotoneHigh: [1.0,0.9,0.7],
  pointPos: [3,4,-2], pointColor: [1,0.9,0.8]
};
const round = deserializeScene(serializeScene(scene));
ok('往返保留 lens=0.6', round.lens === 0.6);
ok('往返保留 lensAmt=-0.35', round.lensAmt === -0.35);
ok('往返保留 clampRad=3', round.clampRad === 3);
ok('往返保留 toneMode=5 (Hejl)', round.toneMode === 5);

// --- 2. toneMode 越界被钳制到 TONE_MODE_MAX（不再硬编码 5 造成未来回归） ---
const over = deserializeScene(serializeScene(Object.assign({}, scene, { toneMode: 99 })));
ok('toneMode 越界钳制到 5', over.toneMode === 5);

// --- 3. 缺少字段时默认值与实时状态一致 ---
const def = deserializeScene({});
ok('默认 lensAmt = 0.3', def.lensAmt === 0.3);
ok('默认 lens = 0', def.lens === 0);

// --- 4. 源码接线：导入处理器已赋值、反序列化已返回、toneMode 使用单一真相源 ---
ok('导入处理器赋值 lens/lensAmt/clampRad',
   /fisheyeNew=s\.fisheyeNew;\s*lens=s\.lens;\s*lensAmt=s\.lensAmt;\s*clampRad=s\.clampRad;/.test(src));
ok('deserializeScene 返回 lens/lensAmt',
   /lens:\s*num\('lens'/.test(src) && /lensAmt:\s*num\('lensAmt'/.test(src));
ok('deserializeScene toneMode 使用 TONE_MODE_MAX(非硬编码 5)',
   /toneMode:\s*Math\.max\(0,\s*Math\.min\(TONE_MODE_MAX/.test(src));

console.log('\n_ci456_scene_roundtrip: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
