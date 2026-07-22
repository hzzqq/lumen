// fix_state.js — 每轮最后调用: 用完整替换重写 state 行(带累计字段, 杜绝 linter 回退造成的重复)
// 用法: node fix_state.js oil lomo [glitch] [fisheye] [pointlight]
const fs = require('fs');
const extras = process.argv.slice(2);
const BASE79 = 'let sceneId=0, maxBounces=6, resScale=1.0, paused=false, envInt=1.0, exposure=1.0, focusDist=9.0, aperture=0.0, sunAz=35.0, sunEl=40.0, sunInt=1.0, autoRotate=false, rotAccum=0, maxSamples=2000, toneMode=0, autoExp=false, fogDensity=0.0, rrOn=false, denoiseOn=false, denIters=3, neeOn=true, bloomOn=false, bloomStr=0.6, bloomThr=1.0, vignetteOn=false, vigStr=0.5, chromaOn=false, chromaStr=0.5, grainOn=false, grainStr=0.08, gamma=2.2, rough=0.0, jitter=1.0, fogColor=[0.8,0.85,0.9], fov=50, bgTop=[0.20,0.36,0.66], bgBottom=[0.62,0.70,0.80], debugMode=0, clampRad=0, satStr=1, contrast=1, sharpen=0, dither=0, temp=0, hue=0, sepia=0, posterize=0, letterbox=0, scanline=0, invert=0, border=0, bright=0, duotone=0, vibrance=0, mono=0, tint=0, balance=0, bleach=0, fade=0, splittone=0, highlights=0, glow=0, solarize=0, expose=0, threshold=0, crossprocess=0, falsecolor=0, gradientmap=0, pastel=0, infrared=0, radial=0, swirl=0, night=0, emboss=0, edge=0, pixelate=0, rgbshift=0, halftone=0, techni=0, vhs=0, colorkey=0, anaglyph=0';
const full = BASE79 + (extras.length ? ', ' + extras.map(e => e + '=0').join(', ') : '') + ';';
let s = fs.readFileSync('main.js', 'utf8');
const re = /let sceneId=0,[^\n]*;\n/;
if (!re.test(s)) throw new Error('state line not found');
s = s.replace(re, full + '\n');
fs.writeFileSync('main.js', s);
console.log('state line rewritten with extras:', extras.join(',') || '(none)');
