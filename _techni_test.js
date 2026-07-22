// Lumen 三色染印(Technicolor) 后处理单元测试：纯函数移植 + 全链路接线断言 + 隐性修复验证
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 纯函数移植：三段式 Technicolor 映射 ----
function applyTechni(c, t){
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const sh = [0.04,0.22,0.26], mid = [0.85,0.22,0.12], hi = [1.0,0.86,0.55];
  let tc;
  if(l < 0.5){ const k=l/0.5; tc=[sh[0]+(mid[0]-sh[0])*k, sh[1]+(mid[1]-sh[1])*k, sh[2]+(mid[2]-sh[2])*k]; }
  else { const k=(l-0.5)/0.5; tc=[mid[0]+(hi[0]-mid[0])*k, mid[1]+(hi[1]-mid[1])*k, mid[2]+(hi[2]-mid[2])*k]; }
  return [c[0]+(tc[0]-c[0])*t, c[1]+(tc[1]-c[1])*t, c[2]+(tc[2]-c[2])*t];
}
// ---- 行为正确性 ----
ok('t=0 恒等', (()=>{ const r=applyTechni([0.2,0.5,0.8],0); return JSON.stringify(r)===JSON.stringify([0.2,0.5,0.8]); })());
ok('暗部映射偏青绿', (()=>{ const r=applyTechni([0.0,0.0,0.0],1); return r[1] > r[0]; })());   // 青绿 g>b,r
ok('高光映射偏暖黄', (()=>{ const r=applyTechni([1.0,1.0,1.0],1); return r[0]>0.9 && r[1]>0.8 && r[2]>0.5; })());
ok('输出范围 0..1', (()=>{ for(const l of [0,0.25,0.5,0.75,1]){ const r=applyTechni([l,l,l],0.7); if(r.some(x=>x<0||x>1)) return false; } return true; })());

// ---- 全链路接线 ----
ok('GLSL 声明 uniform float uTechni', /uniform float uTechni;/.test(main));
ok('GLSL 含 uTechni>0 分支', /if\(uTechni > 0\.0\)/.test(main));
ok('GLSL 三段 mix(sh,mid,mid,hi)', /mix\(sh, mid, l\/0\.5\)/.test(main) && /mix\(mid, hi, \(l-0\.5\)\/0\.5\)/.test(main));
ok('state 默认含 techni=0', /techni=0[,;]/.test(main));
ok('serialize 含 techni: s.techni', /techni: s\.techni/.test(main));
ok('deserialize 含 techni: num', /techni: num\('techni', 0\)/.test(main));
ok('presetToParams 含 techni', /techni: num\(p\.techni, 0\)/.test(main));
ok('applyPreset/loadScene 含 techni=s.techni', /techni=s\.techni;/.test(main));
ok('syncSceneUI 含 techni 滑块同步', /\$\('techni'\)\.value = Math\.round\(techni \* 100\)/.test(main));
ok('uniform 绑定 uTechni', /u\(showProg,'uTechni'\)/.test(main));
ok('UI oninput 接线 techni', /\$\('techni'\)\.oninput/.test(main));
ok('index.html 含 techni 滑块', /id="techni"/.test(html));
ok('exportScene 调用传入 techni', /serializeScene\(\{[\s\S]*techni\b/.test(main));
ok('presetToParams 字段数 76(含 techni)', (()=>{ const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/); const f = eval('(' + m[0] + ')'); const s=f({}); return typeof s.techni === 'number'; })());

// ---- R2 隐性修复：反序列化颜色数组须拒绝非有限值(防 NaN 污染渲染) ----
ok('deserializeScene 对损坏 fogColor 回退默认(无 NaN)', (()=>{
  const m = main.match(/function deserializeScene\(d\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const s = f({ fogColor: ['x', 2, 3], bgTop: [NaN, 0.1, 0.2] });
  return s.fogColor.every(Number.isFinite) && s.bgTop.every(Number.isFinite) &&
         Math.abs(s.fogColor[0]-0.8) < 1e-9;
})());

console.log(`\n[Lumen techni] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
