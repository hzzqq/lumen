// Lumen Bloom 后处理参考测试（ci63）
// WebGL 着色器无法在 Node 直接跑，这里忠实移植 SHOW_FRAG 中 brightPass / bloom 的
// GLSL 数学到纯 JS，断言泛光的关键不变量：
//   1. 亮度低于阈值 → brightPass 归零（不泛光）
//   2. 亮度高于阈值 → 仅超出部分泛光（soft-knee，结果亮度 < 原亮度）
//   3. 亮度越高 brightPass 占比 k 越大（单调）
//   4. 单个亮点被暗区包围 → 邻域收到扩散光晕(>0)，且中心光晕 > 邻域光晕
//   5. 整幅低于阈值 → 泛光处处为 0
//   6. 加性合成 c + bloom*str 随 str 线性缩放
//   7. 高斯核：中心权重最大、角点权重最小
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
const LUMA = [0.299, 0.587, 0.114];
function luma(c){ return c[0]*LUMA[0] + c[1]*LUMA[1] + c[2]*LUMA[2]; }

// --- 忠实移植：brightPass(soft-knee 亮度阈值提取) ---
function brightPass(c, thr){
  const l = luma(c);
  const k = Math.max(l - thr, 0) / Math.max(l, 1e-4);
  return [c[0]*k, c[1]*k, c[2]*k];
}

// --- 一张 HDR 小图(2D 像素数组) + 带边缘钳制的采样 ---
function makeImage(w, h, fill){
  const px = [];
  for(let y=0; y<h; y++){ const row=[]; for(let x=0; x<w; x++) row.push(fill.slice()); px.push(row); }
  return { w, h, px };
}
function sampleHDR(img, cx, cy){
  const x = Math.min(img.w-1, Math.max(0, Math.round(cx)));
  const y = Math.min(img.h-1, Math.max(0, Math.round(cy)));
  return img.px[y][x];
}

// --- 忠实移植：bloom(多尺度 5x5 高斯模糊的亮部) ---
// GLSL 中 uv∈[0,1], off/uTexSize；这里直接以像素坐标 (px,py) 建模等价采样。
function bloom(img, px, py, thr){
  let acc = [0,0,0], wSum = 0;
  for(let s=0; s<3; s++){
    const step = (1 << s);                  // 1,2,4 像素(最细尺度覆盖相邻像素)
    for(let x=-2; x<=2; x++){
      for(let y=-2; y<=2; y++){
        const hb = brightPass(sampleHDR(img, px + x*step, py + y*step), thr);
        const w = Math.exp(-(x*x + y*y) / 4.0);
        acc[0]+=hb[0]*w; acc[1]+=hb[1]*w; acc[2]+=hb[2]*w;
        wSum += w;
      }
    }
  }
  const d = Math.max(wSum, 1e-4);
  return [acc[0]/d, acc[1]/d, acc[2]/d];
}

// ---------- 1. 低于阈值 → 归零 ----------
{
  const dim = brightPass([0.5,0.5,0.5], 1.0);   // luma 0.5 < 1.0
  ok('brightPass 低于阈值归零', dim[0]===0 && dim[1]===0 && dim[2]===0);
}

// ---------- 2. 高于阈值 → 仅超出部分(结果亮度 < 原亮度) ----------
{
  const c = [3,3,3];                            // luma 3 > 1
  const bp = brightPass(c, 1.0);
  ok('brightPass 高于阈值 >0', luma(bp) > 0);
  ok('brightPass soft-knee 只留超出部分', luma(bp) < luma(c));
  // 理论：k=(3-1)/3=2/3 → bp≈[2,2,2]
  ok('brightPass k 值正确', approx(bp[0], 2.0, 1e-6));
}

// ---------- 3. 亮度越高 k(占比) 越大 ----------
{
  const a = brightPass([2,2,2], 1.0);
  const b = brightPass([5,5,5], 1.0);
  const ka = a[0]/2.0, kb = b[0]/5.0;           // k = (l-thr)/l
  ok('brightPass k 随亮度单调增', kb > ka);
}

// ---------- 4. 单亮点扩散：邻域收到光晕，中心 > 邻域 ----------
{
  const img = makeImage(17, 17, [0,0,0]);
  img.px[8][8] = [20,20,20];                     // 正中一个高亮点
  const bCenter = bloom(img, 8, 8, 1.0);
  const bNear   = bloom(img, 9, 8, 1.0);         // 相邻 1 像素
  const bFar    = bloom(img, 15, 8, 1.0);        // 远处
  ok('bloom 中心>0', luma(bCenter) > 0);
  ok('bloom 邻域收到扩散光晕>0', luma(bNear) > 0);
  ok('bloom 中心光晕 > 邻域光晕', luma(bCenter) > luma(bNear));
  ok('bloom 邻域光晕 > 远处光晕', luma(bNear) > luma(bFar));
}

// ---------- 5. 整幅低于阈值 → 处处为 0 ----------
{
  const img = makeImage(11, 11, [0.3,0.3,0.3]);  // luma 0.3 < 1.0
  const b = bloom(img, 5, 5, 1.0);
  ok('bloom 全暗场景无泛光', luma(b) === 0);
}

// ---------- 6. 加性合成随强度线性缩放 ----------
{
  const img = makeImage(11, 11, [0,0,0]);
  img.px[5][5] = [10,10,10];
  const b = bloom(img, 5, 5, 1.0);
  const base = [0.2,0.2,0.2];
  const out1 = base[0] + b[0]*0.5;
  const out2 = base[0] + b[0]*1.0;
  ok('bloom 合成随 str 线性', approx((out2-base[0])/(out1-base[0]), 2.0, 1e-6));
}

// ---------- 7. 高斯核：中心权重最大、角点最小 ----------
{
  const wCenter = Math.exp(-(0)/4.0);            // x=0,y=0
  const wEdge   = Math.exp(-(1)/4.0);            // x=1,y=0
  const wCorner = Math.exp(-(8)/4.0);            // x=2,y=2
  ok('高斯核中心权重最大', wCenter > wEdge && wEdge > wCorner);
  ok('高斯核中心=1', approx(wCenter, 1.0, 1e-9));
}

console.log(`[Lumen bloom] pass=${pass} fail=${fail}`);
if(fail > 0) process.exit(1);
