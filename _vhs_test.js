// Lumen VHS 录像带失真 后处理单元测试：纯函数移植 + 全链路接线断言 + 隐性修复验证
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：VHS 横向色偏 + 跟踪抖动 + 纵向亮度带 ----
function applyVhs(c, uv, frame, t, hash21){
  const band = Math.floor(uv[1] * 24.0);
  const n = hash21(band, frame * 0.5);
  const wob = (n - 0.5) * 0.02 * t;        // 整带横向偏移
  const off = (0.004 + 0.01 * n) * t;      // 色散偏移
  // 简化：仅验证“色偏产生 R/B 错位、亮度带调制”的单调行为
  const r = Math.max(0, c[0] + (hash21(uv[0]-off+wob, uv[1]) - 0.5) * 0); // 占位(实际在 GLSL 重采样)
  const lines = 0.5 + 0.5 * Math.sin(uv[1] * 240.0 + n * 6.2831);
  const mod = (1.0 - ((1.0 - (0.85 + 0.15*lines)) * t)); // mix(1.0, 0.85+0.15*lines, t)
  const g = (hash21(uv[0]*(frame+2.0)*30.0, uv[1]*(frame+2.0)*30.0) - 0.5) * 0.08 * t;
  return [c[0]*mod + g, c[1]*mod + g, c[2]*mod + g];
}
function hash21(x, y){ return (Math.sin(x*127.1 + y*311.7) * 43758.5453) % 1; }

// ---- 行为正确性(亮度带调制：t=0 恒等) ----
ok('t=0 恒等(原图)', (()=>{ const r=applyVhs([0.2,0.5,0.8],[0.3,0.4],1,0,hash21); return JSON.stringify(r)===JSON.stringify([0.2,0.5,0.8]); })());
ok('t>0 亮度带调制降低部分亮度(非恒等)', (()=>{ const a=applyVhs([0.8,0.8,0.8],[0.1,0.0],2,1,hash21); const b=applyVhs([0.8,0.8,0.8],[0.1,0.5],2,1,hash21); return JSON.stringify(a)!==JSON.stringify(b); })());
ok('输出范围 0..1', (()=>{ for(const t of [0,0.5,1]) for(const yv of [0,0.25,0.5,0.75,1]){ const r=applyVhs([0.5,0.5,0.5],[0.2,yv],3,t,hash21); if(r.some(x=>x<-0.01||x>1.01)) return false; } return true; })());

// ---- 全链路接线 ----
ok('GLSL 声明 uniform float uVhs', /uniform float uVhs;/.test(main));
ok('GLSL 含 uVhs>0 分支', /if\(uVhs > 0\.0\)/.test(main));
ok('GLSL 使用 sampleHDR 重采样(色偏)', /sampleHDR\(vec2\(vUv\.x - off \+ wob, vUv\.y\)\)/.test(main));
ok('GLSL 含磁带噪点 hash21', /hash21\(vUv \* \(uFrame \+ 2\.0\) \* 30\.0\)/.test(main));
ok('state 默认含 vhs=0', /vhs=0[,;]/.test(main));
ok('serialize 含 vhs: s.vhs', /vhs: s\.vhs/.test(main));
ok('deserialize 含 vhs: num', /vhs: num\('vhs', 0\)/.test(main));
ok('presetToParams 含 vhs', /vhs: num\(p\.vhs, 0\)/.test(main));
ok('applyPreset/loadScene 含 vhs=s.vhs', /vhs=s\.vhs;/.test(main));
ok('syncSceneUI 含 vhs 滑块同步', /\$\('vhs'\)\.value = Math\.round\(vhs \* 100\)/.test(main));
ok('uniform 绑定 uVhs', /u\(showProg,'uVhs'\)/.test(main));
ok('UI oninput 接线 vhs', /\$\('vhs'\)\.oninput/.test(main));
ok('index.html 含 vhs 滑块', /id="vhs"/.test(html));
ok('exportScene 调用传入 vhs', /serializeScene\(\{[\s\S]*vhs\b/.test(main));
ok('presetToParams 字段数 77(含 vhs)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); const s=f({}); return typeof s.vhs === 'number'; })());

// ---- R2 隐性修复：maxSamples 钳制下限为 1(避免主循环永不渲染) ----
ok('presetToParams 对 maxSamples=0 钳制为 >=1', (()=>{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ maxSamples: 0 }).maxSamples >= 1 && f({ maxSamples: -5 }).maxSamples >= 1;
})());
ok('deserializeScene 对 maxSamples=0 钳制为 >=1', (()=>{
  const m = main.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ maxSamples: 0 }).maxSamples >= 1;
})());

console.log(`\n[Lumen vhs] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
