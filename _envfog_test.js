// Lumen HDRI 环境雾照明统一单元测试：从 main.js 抽取【真实生产函数】envAmbientJ
// （GLSL envAmbient 的 JS 镜像：HDRI 贴图采样逐通道 min 钳制 12.0 防太阳盘过曝 /
// 程序化渐变底色插值 × envInt）烘焙断言；另对 GLSL 分支结构与雾分支换用做结构守护。
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };

const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
function extractFn(name){
  const start = src.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('找不到函数 ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for(; i < src.length; i++){
    const c = src[i];
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return src.slice(start, i+1); }
  }
  throw new Error('函数 ' + name + ' 括号不匹配');
}
const { envAmbientJ } = new Function(extractFn('envAmbientJ') + '\nreturn { envAmbientJ };')();

const TOP = [0.20, 0.36, 0.66], BOT = [0.62, 0.70, 0.80];

// ---- 1) HDRI 分支：逐通道 min 钳制 12.0 ----
{
  const hot = [5000, 8, 150];   // 视线掠过贴图太阳盘的采样（超大辐射）
  const r = envAmbientJ(true, hot, TOP, BOT, 0.8, 1);
  ok('HDRI 太阳盘采样钳到 12.0', r[0] === 12.0 && r[2] === 12.0);
  ok('HDRI 普通天空值原样（8 不被钳）', r[1] === 8);
  ok('HDRI 分支不受 bgTop/bgBottom/envInt 影响', JSON.stringify(envAmbientJ(true, [3, 4, 5], TOP, BOT, -0.9, 0.1)) === JSON.stringify([3, 4, 5]));
  ok('HDRI 恰好 12.0 边界不越', JSON.stringify(envAmbientJ(true, [12, 12, 12], TOP, BOT, 0, 1)) === JSON.stringify([12, 12, 12]));
}

// ---- 2) 程序化分支：渐变插值 × envInt ----
{
  const up = envAmbientJ(false, null, TOP, BOT, 1, 1);      // 天顶 → bgTop
  const mid = envAmbientJ(false, null, TOP, BOT, 0, 1);     // 地平线 → 中点
  const down = envAmbientJ(false, null, TOP, BOT, -1, 1);   // 天底 → bgBottom
  ok('dirY=1 → bgTop', up[2] === 0.66 && up[0] === 0.20);
  ok('dirY=-1 → bgBottom', down[2] === 0.80);
  ok('dirY=0 → 渐变中点', Math.abs(mid[2] - (0.66 + 0.80) / 2) < 1e-12);
  ok('envInt 线性缩放', envAmbientJ(false, null, TOP, BOT, 1, 0.5)[2] === 0.33);
  ok('dirY 越界钳制（-3 → 同 -1）', JSON.stringify(envAmbientJ(false, null, TOP, BOT, -3, 1)) === JSON.stringify(down));
  ok('渐变方向随 dirY 增而趋 bgTop', up[0] < down[0]);   // r 通道 top(0.2) < bottom(0.62)
}

// ---- 3) GLSL 结构守护 ----
ok('GLSL: envAmbient 定义（HDRI 分支 min 钳制 12.0）', /vec3 envAmbient\(vec3 d\)\{\s*\n\s*if\(uEnvHdrOn > 0\.5\) return min\(envSample\(d\), vec3\(12\.0\)\);/.test(src));
ok('GLSL: 程序化分支渐变 × uEnv', /return mix\(uBgBottom, uBgTop, clamp\(d\.y\*0\.5\+0\.5, 0\.0, 1\.0\)\) \* uEnv;/.test(src));
ok('GLSL: 雾分支 amb 换用 envAmbient(rd)', src.includes('vec3 amb = envAmbient(rd);'));
ok('GLSL: 旧内联 amb 行已移除（无重复实现）', !src.includes('vec3 amb = mix(uBgBottom'));
ok('GLSL: envAmbient 定义于 envSample 之后（依赖顺序）', src.indexOf('vec3 envSample(vec3 rd)') < src.indexOf('vec3 envAmbient(vec3 d)'));
ok('GLSL: 主循环未命中分支不受影响（仍可选 envSample）', src.includes('uEnvHdrOn>0.5 ? envSample(rd) : (uScene==7 ? spaceEnv(rd)*uEnv : sky(rd))'));

console.log('envfog: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
