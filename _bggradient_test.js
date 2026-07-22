// ci113 Lumen 背景渐变 bgTop/bgBottom —— 忠实移植 + 源码接线检查
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL:', n); } };

const hex2rgb = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const rgb2hex = c => '#' + c.map(v=>Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('');

// 忠实移植 sky() 上半球的顶/底渐变：mix(bottom, top, pow(clamp(y,0,1),0.5))
function skyTop(y, top, bottom){
  const t = Math.pow(Math.max(0, Math.min(1, y)), 0.5);
  return [ bottom[0]+(top[0]-bottom[0])*t, bottom[1]+(top[1]-bottom[1])*t, bottom[2]+(top[2]-bottom[2])*t ];
}
const TOP = [0.20,0.36,0.66], BOTTOM = [0.62,0.70,0.80];
ok('默认 bgTop = [0.20,0.36,0.66]', JSON.stringify(TOP) === JSON.stringify([0.20,0.36,0.66]));
ok('默认 bgBottom = [0.62,0.70,0.80]', JSON.stringify(BOTTOM) === JSON.stringify([0.62,0.70,0.80]));
ok('默认顶色 hex = #335ca8', rgb2hex(TOP) === '#335ca8');
ok('默认底色 hex = #9eb3cc', rgb2hex(BOTTOM) === '#9eb3cc');
// 渐变端点
ok('y=0 取底色(horizon)', JSON.stringify(skyTop(0, TOP, BOTTOM)) === JSON.stringify(BOTTOM));
ok('y=1 取顶色(zenith)', JSON.stringify(skyTop(1, TOP, BOTTOM)) === JSON.stringify(TOP));
// y=0.5 为 mix(底,顶, sqrt(0.5)) 偏顶
{
  const c = skyTop(0.5, TOP, BOTTOM);
  ok('y=0.5 介于底顶之间(更靠顶色)', c[0] > TOP[0] && c[0] < BOTTOM[0]);
}
// hex 往返
ok('hex↔rgb 往返', rgb2hex(hex2rgb(rgb2hex(TOP))) === rgb2hex(TOP));

// 源码接线
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok('shader 声明 uBgTop/uBgBottom', /uniform vec3\s+uBgTop;/.test(main) && /uniform vec3\s+uBgBottom;/.test(main));
ok('sky 使用 uBgTop/uBgBottom', /vec3 zenith = uBgTop;/.test(main) && /vec3 horizon = uBgBottom;/.test(main));
ok('状态含 bgTop/bgBottom', /bgTop=\[0\.20,0\.36,0\.66\], bgBottom=\[0\.62,0\.70,0\.80\]/.test(main));
ok('serializeScene 含 bgTop/bgBottom', /bgTop: s\.bgTop, bgBottom: s\.bgBottom/.test(main));
ok('deserializeScene 含 bgTop/bgBottom', /bgTop: fin3\(d\.bgTop, \[0\.20,0\.36,0\.66\]\)/.test(main) && /bgBottom: fin3\(d\.bgBottom, \[0\.62,0\.70,0\.80\]\)/.test(main));
ok('presetToParams 含 bgTop/bgBottom', /bgTop: fin3\(p\.bgTop, \[0\.20,0\.36,0\.66\]\)/.test(main));
ok('applyPreset/importScene 赋值', /bgBottom=s\.bgBottom \? s\.bgBottom\.slice\(\)/.test(main));
ok('uniform 绑定 uBgTop/uBgBottom', /uniform3f\(u\(ptProg,'uBgTop'\)/.test(main) && /uniform3f\(u\(ptProg,'uBgBottom'\)/.test(main));
ok('exportScene 含 bgTop/bgBottom', /fov, bgTop, bgBottom, debugMode, toneMode/.test(main));
ok('UI oninput 绑定 bgTop/bgBottom', /\$\('bgTop'\)\.oninput/.test(main) && /\$\('bgBottom'\)\.oninput/.test(main));
ok('index.html 含取色器', /id="bgTop"/.test(html) && /id="bgBottom"/.test(html));

console.log(`\nci113 bgGradient: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
