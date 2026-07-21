// Lumen NEE 直接光采样：参考实现（忠实移植 GLSL neeDirect 的面积采样数学）。
// 校验：遮挡/背向/无面光源 返回 0；同几何下 direct ∝ R²（pdfA=1/4πR²）。
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
// 面光源（有限球）参数：与 GLSL neeDirect 严格一致
const LIGHTS = {
  2: { C:[0,4.5,0], R:1.1, Le:[18,18,18] },
  5: { C:[0,5.0,0], R:1.4, Le:[16,16,16] },
  6: { C:[0,4.0,0], R:2.0, Le:[14,14,14] },
};
function neeDirect(p, n, albedo, scene, occ, u){
  const L = LIGHTS[scene];
  if(!L) return [0,0,0];                       // 无面光源（场景 0/1/3/4）→ 0
  const lp = [L.C[0]+u[0]*L.R, L.C[1]+u[1]*L.R, L.C[2]+u[2]*L.R];
  const d = sub(lp, p); const dist2 = dot(d,d); const dist = Math.sqrt(dist2); const w = scale(d, 1/dist);
  const cosS = dot(n, w); if(cosS <= 0) return [0,0,0];      // 接收面背向光源
  if(occ(w)) return [0,0,0];                            // 被遮挡
  const ln = norm(sub(lp, L.C)); const cosL = dot(ln, scale(w,-1)); if(cosL <= 0) return [0,0,0]; // 光源背面
  const pdfA = 1/(4*Math.PI*L.R*L.R);
  const G = cosS*cosL/dist2;
  return scale(albedo, (1/Math.PI)*L.Le[0]*G/pdfA);
}
let pass=0, fail=0;
const ok=(n,c)=> c ? pass++ : (fail++, console.log('  FAIL', n));
const fin=v=> Number.isFinite(v) && v>0;

// 标准几何：p 在地面、法线朝上；u 指向“光源朝 p 的一侧”（保证 cosS、cosL>0）
const p=[0,0,0], nUp=[0,1,0], nDown=[0,-1,0], alb=[1,1,1];
const uFacing = norm(sub(p, LIGHTS[2].C));   // = [0,-1,0]，lp 落在球面朝 p 一侧
const uAway   = norm(LIGHTS[2].C);           // = [0,1,0]，lp 在背面

ok('场景2 未遮挡正面 → 直接光照>0 且有限', (()=>{ const d=neeDirect(p,nUp,alb,2,()=>false,uFacing); return fin(d[0]); })());
ok('场景2 被遮挡 → 0', (()=>{ const d=neeDirect(p,nUp,alb,2,()=>true,uFacing); return d[0]===0 && d[1]===0; })());
ok('场景2 接收面背向(法线朝下) → 0', (()=>{ const d=neeDirect(p,nDown,alb,2,()=>false,uFacing); return d[0]===0; })());
ok('场景2 光源背面(lp 在背面) → 0', (()=>{ const d=neeDirect(p,nUp,alb,2,()=>false,uAway); return d[0]===0; })());
ok('场景0 无面光源 → 0', neeDirect(p,nUp,alb,0,()=>false,uFacing)[0]===0);
ok('场景1 无面光源 → 0', neeDirect(p,nUp,alb,1,()=>false,uFacing)[0]===0);
ok('场景3 无面光源 → 0', neeDirect(p,nUp,alb,3,()=>false,uFacing)[0]===0);
ok('场景4 Cornell(无限平面光) → 0（NEE 仅覆盖有限球光源）', neeDirect(p,nUp,alb,4,()=>false,uFacing)[0]===0);

// pdfA ∝ 1/R²：同几何下 direct 随 R 增大而增大（场景6>R5>R2）
const d2 = neeDirect(p,nUp,alb,2,()=>false,uFacing)[0];
const d5 = neeDirect(p,nUp,alb,5,()=>false,uFacing)[0];
const d6 = neeDirect(p,nUp,alb,6,()=>false,uFacing)[0];
ok('direct 随光源半径增大（6 > 5 > 2）', d6 > d5 && d5 > d2 && fin(d6));

console.log(`\n[Lumen NEE] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
