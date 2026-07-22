// Lumen 红蓝立体(Anaglyph) 后处理单元测试：纯函数移植 + 全链路接线断言 + 隐性修复验证
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：红/青立体(左眼取红, 右眼取绿蓝) ----
function applyAnaglyph(L, R, t){
  const an = [L[0], R[1], R[2]];
  return [L[0]+(an[0]-L[0])*t, L[1]+(an[1]-L[1])*t, L[2]+(an[2]-L[2])*t];
}
// ---- 行为正确性 ----
ok('t=0 恒等', (()=>{ const L=[0.2,0.5,0.8], R=[0.2,0.5,0.8]; const r=applyAnaglyph(L,R,0); return JSON.stringify(r)===JSON.stringify(L); })());
ok('t=1 红通道取左眼', (()=>{ const L=[0.9,0.1,0.1], R=[0.0,0.8,0.8]; const r=applyAnaglyph(L,R,1); return Math.abs(r[0]-0.9)<1e-9; })());
ok('t=1 绿蓝通道取右眼', (()=>{ const L=[0.9,0.1,0.1], R=[0.0,0.8,0.8]; const r=applyAnaglyph(L,R,1); return Math.abs(r[1]-0.8)<1e-9 && Math.abs(r[2]-0.8)<1e-9; })());
ok('输出范围 0..1', (()=>{ for(const t of [0,0.5,1]){ const r=applyAnaglyph([0.3,0.6,0.1],[0.7,0.2,0.9],t); if(r.some(x=>x<0||x>1)) return false; } return true; })());

// ---- 全链路接线 ----
ok('GLSL 声明 uniform float uAnaglyph', /uniform float uAnaglyph;/.test(main));
ok('GLSL 含 uAnaglyph>0 分支', /if\(uAnaglyph > 0\.0\)/.test(main));
ok('GLSL 左右眼错位采样 sampleHDR', /sampleHDR\(vUv \+ vec2\(s, 0\.0\)\)/.test(main) && /sampleHDR\(vUv - vec2\(s, 0\.0\)\)/.test(main));
ok('GLSL 红/青组合 vec3(L.r, R.g, R.b)', /vec3\(L\.r, R\.g, R\.b\)/.test(main));
ok('state 默认含 anaglyph=0', /anaglyph=0[,;]/.test(main));
ok('serialize 含 anaglyph: s.anaglyph', /anaglyph: s\.anaglyph/.test(main));
ok('deserialize 含 anaglyph: num', /anaglyph: num\('anaglyph', 0\)/.test(main));
ok('presetToParams 含 anaglyph', /anaglyph: num\(p\.anaglyph, 0\)/.test(main));
ok('applyPreset/loadScene 含 anaglyph=s.anaglyph', /anaglyph=s\.anaglyph;/.test(main));
ok('syncSceneUI 含 anaglyph 滑块同步', /\$\('anaglyph'\)\.value = Math\.round\(anaglyph \* 100\)/.test(main));
ok('uniform 绑定 uAnaglyph', /u\(showProg,'uAnaglyph'\)/.test(main));
ok('UI oninput 接线 anaglyph', /\$\('anaglyph'\)\.oninput/.test(main));
ok('index.html 含 anaglyph 滑块', /id="anaglyph"/.test(html));
ok('exportScene 调用传入 anaglyph', /serializeScene\(\{[\s\S]*\banaglyph\b[\s\S]*\}\)/.test(main));
ok('presetToParams 字段数 >=80(含 anaglyph)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); return Object.keys(f({})).length >= 80; })());

// ---- R2 隐性修复：fov 钳制到 [1,179](避免相机退化 tan 越界) ----
ok('presetToParams 对 fov=0 钳制到 >=1', (()=>{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ fov: 0 }).fov >= 1;
})());
ok('presetToParams 对 fov=200 钳制到 <=179', (()=>{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ fov: 200 }).fov <= 179;
})());
ok('deserializeScene 对 fov=0 钳制到 >=1', (()=>{
  const m = main.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  return f({ fov: 0 }).fov >= 1;
})());

console.log(`\n[Lumen anaglyph] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
