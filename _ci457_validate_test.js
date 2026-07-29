// ci457 验收：从 main.js 抽取 validateScene 纯函数并运行断言。
// 不执行 main.js 本体（其顶层依赖 document/canvas），仅 brace-match 抽取目标函数 eval 后测试。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const mainPath = path.join(__dirname, 'main.js');
const main = fs.readFileSync(mainPath, 'utf8');

// ---- 从文本抽取函数定义（brace 匹配，避免正则误伤） ----
function extractFn(name){
  const start = main.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('function ' + name + ' not found');
  let depth = 0, i = main.indexOf('{', start);
  for(; i < main.length; i++){
    const c = main[i];
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0){ return main.slice(start, i+1); } }
  }
  throw new Error('unbalanced braces in ' + name);
}
const validateScene = eval('(' + extractFn('validateScene') + ')');

let fails = [];
function check(cond, msg){ if(!cond) fails.push(msg); }

// 合法默认场景应通过
const okScene = validateScene({
  fov:50, exposure:1, maxBounces:6, maxSamples:2000, aperture:0, rough:0, jitter:1, gamma:2.2,
  sunAz:35, sunEl:40, selHue:0, selRange:45, vigStr:0.5, chromaStr:0.5, grainStr:0.08,
  bloomStr:0.6, bloomThr:1.0, lensAmt:0.3, edgeDetect:0, sepiaNew:0, fisheyeNew:0, crossHatch:0,
  fogColor:[0.8,0.85,0.9], bgTop:[0.20,0.36,0.66], bgBottom:[0.62,0.70,0.80],
  duotoneShadow:[0.1,0.1,0.2], duotoneHigh:[0.9,0.8,0.6], pointColor:[1,0.9,0.8],
  target:[0,1.5,0], vignetteOn:false, bloomOn:false, neeOn:true, rrOn:false
});
check(okScene.ok === true, '合法场景应 ok，实际: ' + JSON.stringify(okScene.issues));

// 非法场景应被逐一捕获
const bad = validateScene({
  fov:200, exposure:-1, maxSamples:0, gamma:9, sunEl:200,
  fogColor:[1,2], target:'x', vignetteOn:'yes', bloomOn:5
});
check(bad.ok === false, '非法场景应不 ok');
const fields = bad.issues.map(i=>i.field);
for(const f of ['fov','exposure','maxSamples','gamma','sunEl','fogColor','target','vignetteOn','bloomOn'])
  check(fields.includes(f), '应捕获字段 ' + f + '，实际 issues=' + JSON.stringify(bad.issues));

// 边界值应放行（不报 error）
const edge = validateScene({ fov:1, exposure:0, maxBounces:32, maxSamples:30000, aperture:0, rough:0, jitter:0, gamma:0.1, sunAz:-360, sunEl:-90, selHue:360, selRange:180, vigStr:2, chromaStr:2, grainStr:2, bloomStr:2, bloomThr:5, lensAmt:1, edgeDetect:1, sepiaNew:1, fisheyeNew:1, crossHatch:1, fogColor:[0,0,0], bgTop:[0,0,0], bgBottom:[0,0,0], duotoneShadow:[0,0,0], duotoneHigh:[0,0,0], pointColor:[0,0,0], target:[0,0,0], vignetteOn:true, bloomOn:true, neeOn:false, rrOn:true });
check(edge.ok === true, '边界值应放行，实际: ' + JSON.stringify(edge.issues));

// 非对象根
check(validateScene(undefined).ok === false, 'undefined 根应不 ok');
check(validateScene(42).ok === false, '数字根应不 ok');

// 语法检查
try { execSync(`"${NODE}" --check "${mainPath}"`, { stdio:'pipe' }); }
catch(e){ fails.push('node --check main.js 失败: ' + (e.stderr ? e.stderr.toString() : e.message)); }

if(fails.length === 0){
  console.log('CI457_VALIDATE_PASS ✅ validateScene 捕获错误配置且放行边界值');
  process.exit(0);
} else {
  console.log('CI457_VALIDATE_FAIL ❌');
  fails.forEach(f=>console.log('  - ' + f));
  process.exit(1);
}
