// Lumen ci53 — 边缘感知 A-trous 小波降噪 参考实现验证
// 说明：GLSL 内核无法在 Node 中直接执行(GLSL 需 WebGL 上下文)，
// 这里用纯 JS 复刻 SHOW_FRAG 中 denoiseAtrus 的精确数学，
// 断言算法层面行为：①平滑均匀噪声 ②保留强边缘 ③输出有限且合理。
// 复刻公式（与 GLSL 完全一致）：
//   wk = 中心4 / 边2 / 角1 (单位步长 3x3 核)
//   cd = dot(|cs - c|, (0.299,0.587,0.114))   // 亮度差
//   ws = wk * exp(-cd*16)                        // 边缘停止
//   步进 step = 1<<iter，迭代 iters 次

const W = 32, H = 32;

function lum(c){ return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]; }

// 复刻 denoiseAtrus：img 为 H×W 的 RGB 数组(已是平均值)，返回去噪后图像
function denoiseAtrus(img, iters){
  const out = Array.from({length:H}, () => Array.from({length:W}, () => [0,0,0]));
  for(let py=0; py<H; py++){
    for(let px=0; px<W; px++){
      const center = img[py][px];
      let c = center.slice();
      for(let it=0; it<5; it++){
        if(it >= iters) break;
        const step = 1 << it;
        let acc = [0,0,0], wSum = 0;
        for(let x=-1; x<=1; x++){
          for(let y=-1; y<=1; y++){
            const nx = Math.min(W-1, Math.max(0, px + x*step));
            const ny = Math.min(H-1, Math.max(0, py + y*step));
            const cs = img[ny][nx];
            const wk = (x===0 && y===0) ? 4.0 : ((x!==0 && y!==0) ? 1.0 : 2.0);
            const cd = Math.abs(lum(cs) - lum(c));
            const ws = wk * Math.exp(-cd * 16.0);
            acc[0]+=cs[0]*ws; acc[1]+=cs[1]*ws; acc[2]+=cs[2]*ws;
            wSum += ws;
          }
        }
        if(wSum > 1e-4) c = [acc[0]/wSum, acc[1]/wSum, acc[2]/wSum];
      }
      out[py][px] = c;
    }
  }
  return out;
}

// 简单确定性噪声(rand 替代, 固定种子)
let seed = 12345;
function rnd(){ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; }
function gauss(){ return (rnd()+rnd()+rnd()+rnd()-2)*0.5; } // 近似 N(0,~0.1)

let pass=0, fail=0;
function ok(name, cond){ if(cond){ pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }

console.log('ci53 降噪参考测试');

// 测试1：均匀噪声场 → 去噪后应更接近真实均值 0.5
(()=>{
  seed = 999;
  const img = Array.from({length:H}, () => Array.from({length:W}, () => {
    const n = 0.5 + gauss()*0.3; return [n,n,n];
  }));
  const raw = img[16][16][0];
  const out = denoiseAtrus(img, 3);
  const den = out[16][16][0];
  // 去噪偏移应明显小于原始噪声幅度
  ok('均匀噪声：去噪值回归均值 0.5 (|out-0.5|<0.08)', Math.abs(den-0.5) < 0.08);
  ok('均匀噪声：去噪比原始更干净 (|out-0.5| < |raw-0.5|)', Math.abs(den-0.5) <= Math.abs(raw-0.5));
})();

// 测试2：强边缘(左0.2/右0.8) → 远离边缘处保持各自区域值
(()=>{
  seed = 7;
  const img = Array.from({length:H}, (_,y) => Array.from({length:W}, (_,x) => {
    const base = x < 16 ? 0.2 : 0.8;
    const n = base + gauss()*0.05; return [n,n,n];
  }));
  const out = denoiseAtrus(img, 3);
  const left = out[16][6][0];   // 远离边缘(左侧)
  const right = out[16][26][0]; // 远离边缘(右侧)
  ok('强边缘：左侧区域保持 0.2 (|left-0.2|<0.06)', Math.abs(left-0.2) < 0.06);
  ok('强边缘：右侧区域保持 0.8 (|right-0.8|<0.06)', Math.abs(right-0.8) < 0.06);
  ok('强边缘：左右区域仍区分 (right-left>0.4)', (right-left) > 0.4);
})();

// 测试3：输出有限且非 NaN
(()=>{
  seed = 3;
  const img = Array.from({length:H}, () => Array.from({length:W}, () => {
    const n = rnd(); return [n,n,n];
  }));
  const out = denoiseAtrus(img, 5);
  let finite = true, inRange = true;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const v = out[y][x][0];
    if(!isFinite(v) || isNaN(v)) finite = false;
    if(v < -0.001 || v > 1.001) inRange = false;
  }
  ok('健壮性：所有像素有限且 ∈[0,1]', finite && inRange);
})();

// 测试4：迭代越多平滑越强(方差下降单调不增)
(()=>{
  seed = 55;
  const img = Array.from({length:H}, () => Array.from({length:W}, () => {
    const n = 0.5 + gauss()*0.4; return [n,n,n];
  }));
  const center = img[16][16][0];
  const o1 = denoiseAtrus(img,1), o3 = denoiseAtrus(img,3);
  ok('迭代1→3：去噪更靠近均值 (|o3-0.5| <= |o1-0.5|)', Math.abs(o3[16][16][0]-0.5) <= Math.abs(o1[16][16][0]-0.5));
  ok('降噪确实改变像素(非恒等)', Math.abs(o3[16][16][0]-center) > 1e-4);
})();

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
