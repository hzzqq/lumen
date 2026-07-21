// Lumen Chromatic Aberration 色差后处理参考测试（ci87）
// WebGL 着色器无法在 Node 直接跑，这里忠实移植 SHOW_FRAG 中色差分支的
// GLSL 数学到纯 JS，断言镜头色散的关键不变量：
//   1. 强度=0（关闭）→ 完全不偏移，结果等于原采样（恒等）
//   2. 开启后：R 通道取自 uv - dir*amt（朝中心方向），B 通道取自 uv + dir*amt（离中心方向）
//   3. G 通道保持不变（以当前绿通道为基准）
//   4. 偏移量 amt = str * 0.03 随强度线性缩放（强度 1 时边缘最大偏移 3%）
//   5. 结果各分量有限（bounded）
//   6. 朝中心/离中心方向符号正确（角点验证）
'use strict';
let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + name); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// --- 忠实移植：SHOW_FRAG 中 uChroma==1 分支 ---
// vec3 r = sampleHDR(vUv - dir*amt); vec3 b = sampleHDR(vUv + dir*amt);
// c = vec3(r.r, c.g, b.b);  其中 c.g 来自基准 sampleHDR(vUv)
function chromaSplit(uv, str, sampleHDR){
  const dir = [uv[0] - 0.5, uv[1] - 0.5];
  const amt = str * 0.03;
  const g = sampleHDR(uv);
  const r = sampleHDR([uv[0] - dir[0] * amt, uv[1] - dir[1] * amt]);
  const b = sampleHDR([uv[0] + dir[0] * amt, uv[1] + dir[1] * amt]);
  return { r, g, b, out: [r[0], g[1], b[2]] };
}

// 确定性采样：返回 [uv.x, uv.y, 0.42]
function sampleHDR(uv){ return [uv[0], uv[1], 0.42]; }

// 1. 关闭（str=0）→ 恒等
{
  const uv = [0.9, 0.3];
  const { out } = chromaSplit(uv, 0, sampleHDR);
  const base = sampleHDR(uv);
  ok('str=0 → R 不变', approx(out[0], base[0]));
  ok('str=0 → G 不变', approx(out[1], base[1]));
  ok('str=0 → B 不变', approx(out[2], base[2]));
}

// 2. 开启后：R/B 取自偏移采样，G 取自基准
{
  const uv = [0.9, 0.3];
  const { r, g, b, out } = chromaSplit(uv, 0.5, sampleHDR);
  const dir = [uv[0] - 0.5, uv[1] - 0.5];   // [0.4, -0.2]
  const amt = 0.5 * 0.03;                      // 0.015
  ok('R 取自 uv - dir*amt', approx(r[0], uv[0] - dir[0] * amt) && approx(r[1], uv[1] - dir[1] * amt));
  ok('B 取自 uv + dir*amt', approx(b[0], uv[0] + dir[0] * amt) && approx(b[1], uv[1] + dir[1] * amt));
  ok('G 取自基准 uv', approx(g[0], uv[0]) && approx(g[1], uv[1]));
  ok('输出 = [r.r, g.g, b.b]', approx(out[0], r[0]) && approx(out[1], g[1]) && approx(out[2], b[2]));
  ok('数值正确: out ≈ [0.894, 0.3, 0.42]', approx(out[0], 0.894) && approx(out[1], 0.3) && approx(out[2], 0.42));
}

// 3. amt 随强度线性缩放：str=1 的偏移是 str=0.5 的两倍
{
  const uv = [0.9, 0.3];
  const lo = chromaSplit(uv, 0.5, sampleHDR);
  const hi = chromaSplit(uv, 1.0, sampleHDR);
  // R 采样的 uv.x：lo → 0.9 - 0.4*0.015 = 0.894；hi → 0.9 - 0.4*0.03 = 0.888
  ok('amt 线性: hi.r.x = 0.888', approx(hi.r[0], 0.888));
  ok('amt 线性: lo.r.x = 0.894', approx(lo.r[0], 0.894));
  ok('amt 线性: 偏移量翻倍 (hi 比 lo 更靠中心 0.006)', approx(lo.r[0] - hi.r[0], 0.006));
}

// 4. 结果各分量有限（bounded）
{
  let bounded = true;
  for(const str of [0, 0.1, 0.5, 1.0, 2.0]){
    for(let x = 0; x <= 4; x++) for(let y = 0; y <= 4; y++){
      const o = chromaSplit([x / 4, y / 4], str, sampleHDR).out;
      if(!isFinite(o[0]) || !isFinite(o[1]) || !isFinite(o[2])) bounded = false;
    }
  }
  ok('输出各分量有限', bounded);
}

// 5. 方向符号（角点 uv=[0,0]，dir=[-0.5,-0.5]）：R 朝中心(+) 、B 离中心(-)
{
  const uv = [0.0, 0.0];
  const { r, b } = chromaSplit(uv, 0.5, sampleHDR);
  ok('角点 R 朝中心 (r.x > uv.x)', r[0] > uv[0]);
  ok('角点 B 离中心 (b.x < uv.x)', b[0] < uv[0]);
  ok('角点 R 朝中心 (r.y > uv.y)', r[1] > uv[1]);
  ok('角点 B 离中心 (b.y < uv.y)', b[1] < uv[1]);
}

console.log(`\n_chroma_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
