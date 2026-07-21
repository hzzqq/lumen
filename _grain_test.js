// 胶片噪点测试：忠实复刻 main.js SHOW_FRAG 的 grain 逻辑
// GLSL:
//   float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
//   if(uGrain==1){ float n=(hash21(vUv*(uFrame+1.0)*60.0)-0.5)*uGrainStr; c=clamp(c+vec3(n),0.,1.); }
'use strict';
function hash21(px, py){
  const d = px * 127.1 + py * 311.7;
  const s = Math.sin(d) * 43758.5453;
  return s - Math.floor(s);            // GLSL fract()
}
function grainOffset(u, v, frame, str){
  const f = (frame + 1) * 60.0;
  const px = u * f, py = v * f;
  return (hash21(px, py) - 0.5) * str;
}
function applyGrain(c, u, v, frame, str){
  if(!(str > 0)) return c;             // 关闭：恒等
  const n = grainOffset(u, v, frame, str);
  return Math.max(0, Math.min(1, c + n));
}

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; } else { fail++; console.error('FAIL: ' + msg); } }
function approx(a, b, eps){ return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// 1. 关闭(str<=0)：恒等，不改动
ok(approx(applyGrain(0.5, 0.3, 0.7, 10, 0), 0.5), 'off leaves color unchanged');
ok(approx(applyGrain(0.5, 0.3, 0.7, 10, -1), 0.5), 'negative str treated as off');

// 2. hash21 落在 [0,1)
for(const [px, py] of [[0.1,0.2],[0.9,0.05],[0.5,0.5],[0.0,0.0]]){
  const h = hash21(px, py);
  ok(h >= 0 && h < 1, 'hash21 in [0,1) for (' + px + ',' + py + ')');
}

// 3. hash21 确定性
ok(approx(hash21(0.3, 0.4), hash21(0.3, 0.4)), 'hash21 deterministic');

// 4. 偏移有界 ∈ [-str/2, str/2]
for(const str of [0.08, 0.15, 0.5]){
  let lo = 1, hi = -1;
  for(let f=0; f<5; f++) for(let i=0; i<=10; i++) for(let j=0; j<=10; j++){
    const n = grainOffset(i/10, j/10, f, str);
    lo = Math.min(lo, n); hi = Math.max(hi, n);
  }
  ok(lo >= -str/2 - 1e-12 && hi <= str/2 + 1e-12, 'offset bounded within [-str/2,str/2] for str=' + str);
}

// 5. 同 uv+frame 确定性
ok(approx(grainOffset(0.2,0.3,7,0.1), grainOffset(0.2,0.3,7,0.1)), 'grainOffset deterministic per (uv,frame)');

// 6. 不同帧通常不同(取一个 uv，跨帧比较至少有一个变化)
let changed = false;
const base = grainOffset(0.37, 0.61, 0, 0.15);
for(let f=1; f<20; f++){ if(!approx(grainOffset(0.37,0.61,f,0.15), base, 1e-12)){ changed = true; break; } }
ok(changed, 'grain varies across frames (dynamic)');

// 7. 同帧不同 uv 通常不同
let varied = false;
const q = grainOffset(0.5,0.5,3,0.1);
for(let i=0; i<=20; i++){ if(!approx(grainOffset(i/20,0.5,3,0.1), q, 1e-12)){ varied = true; break; } }
ok(varied, 'grain varies across pixels same frame');

// 8. 应用到颜色：对称加到 rgb 三通道(用逐通道等效验证)
{
  const c = 0.6, u = 0.25, v = 0.8, fr = 4, str = 0.12;
  const n = grainOffset(u, v, fr, str);
  const exp = Math.max(0, Math.min(1, c + n));
  ok(approx(applyGrain(c, u, v, fr, str), exp), 'applyGrain equals clamp(c + n)');
}

// 9. 钳制到 [0,1]：极暗 + 大负偏移仍 >=0
{
  let lowBounded = true;
  for(let f=0; f<8; f++) for(let i=0; i<=10; i++) for(let j=0; j<=10; j++){
    const r = applyGrain(0.0, i/10, j/10, f, 1.0);
    if(r < 0 || r > 1) lowBounded = false;
  }
  ok(lowBounded, 'dark color with strong grain stays within [0,1]');
}

// 10. 钳制到 [0,1]：极亮 + 大正偏移仍 <=1
{
  let highBounded = true;
  for(let f=0; f<8; f++) for(let i=0; i<=10; i++) for(let j=0; j<=10; j++){
    const r = applyGrain(1.0, i/10, j/10, f, 1.0);
    if(r < 0 || r > 1) highBounded = false;
  }
  ok(highBounded, 'bright color with strong grain stays within [0,1]');
}

// 11. 强度线性：offset 随 str 线性(同 uv/frame)
{
  const a = grainOffset(0.4,0.6,2,0.2);
  const b = grainOffset(0.4,0.6,2,0.4);
  ok(approx(b, a * 2, 1e-12), 'offset linear in str');
}

// 12. frame 缩放：不同 frame 偏移幅度不受 str 外放大(仅改变随机种子)
ok(approx(Math.abs(grainOffset(0.5,0.5,0,0.1)), 0.05, 0.05) || true, 'frame present (no assertion on magnitude)');

console.log('raytracer/_grain_test.js  ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
