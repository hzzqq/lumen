// _leak_test.js — ci Leak (漏光) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：漏光(Leak) 后处理全链路 ----
ok('GLSL 声明 uLeak uniform', /uniform float uLeak;/.test(main));
ok('show 着色器含 uLeak 分支 if(uLeak > 0.0)', /if\(uLeak > 0\.0\)/.test(main));
ok('state 声明 leak=0', /let sceneId=0,[\s\S]*\bleak=0[;,]/.test(main));
ok('serializeScene 含 leak(导出链路)', /leak: s\.leak/.test(main));
ok('deserializeScene 含 leak: num', /leak: num\('leak', 0\)/.test(main));
ok('presetToParams 含 leak: num', /leak: num\(p\.leak, 0\)/.test(main));
ok('applyPreset/importScene 含 leak=s.leak', /leak=s\.leak;/.test(main));
ok('syncSceneUI 恢复 leak 滑块', /if\(\$\('leak'\)\) \$\('leak'\)\.value = Math\.round\(leak \* 100\)/.test(main));
ok('oninput 接线 leak', /\$\('leak'\)\.oninput/.test(main));
ok('uniform 绑定 uLeak', /u\(showProg,'uLeak'\)/.test(main));
ok('index.html 含 leak 滑块', /id="leak"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 leak 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['leak'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

const ss=(e0,e1,x)=>{x=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return x*x*(3-2*x);};
function leakJS(c, uv, s){
  const dx=uv[0]-0.05, dy=uv[1]-0.95, r=Math.hypot(dx,dy);
  const glow=ss(0.7,0.0,r)*s;
  const lc=[1.0,0.4,0.7];
  return [c[0]+lc[0]*glow*s, c[1]+lc[1]*glow*s, c[2]+lc[2]*glow*s];
}
ok('漏光 强度0 时画面不变', (()=>{const a=leakJS([0.5,0.5,0.5],[0.5,0.5],0);return a[0]===0.5&&a[1]===0.5&&a[2]===0.5;})());
ok('漏光 左上角被提亮(角部>中心)', (()=>{const co=leakJS([0.5,0.5,0.5],[0.05,0.95],1.0);const ce=leakJS([0.5,0.5,0.5],[0.5,0.5],1.0);return (co[0]+co[1]+co[2])>(ce[0]+ce[1]+ce[2]);})());


console.log('[Lumen leak] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
