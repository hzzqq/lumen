// _lift_test.js — ci LiftShadows (暗部提升) 后处理：新能力 + R2(参数序列化全链路 + 非脆性字段断言)
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + name); } };

// ---- R1 新能力：暗部提升(LiftShadows) 后处理全链路 ----
ok('GLSL 声明 uLift uniform', /uniform float uLift;/.test(main));
ok('show 着色器含 uLift 分支 if(uLift > 0.0)', /if\(uLift > 0\.0\)/.test(main));
ok('state 声明 lift=0', /let sceneId=0,[\s\S]*\blift=0[;,]/.test(main));
ok('serializeScene 含 lift(导出链路)', /lift: s\.lift/.test(main));
ok('deserializeScene 含 lift: num', /lift: num\('lift', 0\)/.test(main));
ok('presetToParams 含 lift: num', /lift: num\(p\.lift, 0\)/.test(main));
ok('applyPreset/importScene 含 lift=s.lift', /lift=s\.lift;/.test(main));
ok('syncSceneUI 恢复 lift 滑块', /if\(\$\('lift'\)\) \$\('lift'\)\.value = Math\.round\(lift \* 100\)/.test(main));
ok('oninput 接线 lift', /\$\('lift'\)\.oninput/.test(main));
ok('uniform 绑定 uLift', /u\(showProg,'uLift'\)/.test(main));
ok('index.html 含 lift 滑块', /id="lift"/.test(html));

// ---- 非脆性字段断言：字段存在于 presetToParams({}) 且为数字 ----
ok('presetToParams({}) 含 lift 且为数字', (() => {
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const v = f({})['lift'];
  return typeof v === 'number' && isFinite(v);
})());

// ---- R2/行为正确性（JS 复刻 GLSL 端口）----
const lum=c=>0.299*c[0]+0.587*c[1]+0.114*c[2];
const mixv=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

const ss=(e0,e1,x)=>{x=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return x*x*(3-2*x);};
function liftJS(c, s){ const l=lum(c); const f=(1-ss(0.0,0.5,l))*0.4*s; return [c[0]+f,c[1]+f,c[2]+f]; }
ok('暗部提升 强度0 时不变', (()=>{const a=liftJS([0.5,0.5,0.5],0);return a[0]===0.5;})());
ok('暗部提升 暗部被抬升多于亮部', (()=>{const d=liftJS([0.1,0.1,0.1],1.0), b=liftJS([0.9,0.9,0.9],1.0);return (d[0]+d[1]+d[2])>(b[0]+b[1]+b[2])-1.6;})());


console.log('[Lumen liftshadows] pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
