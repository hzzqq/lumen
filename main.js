// Lumen — WebGL2 实时路径追踪器
// 纯手写：全屏 quad + ping-pong 浮点累积缓冲 + GLSL 蒙特卡洛路径追踪
// 新增：三角形网格 + BVH 加速 (JS 建树、打包进浮点纹理、GLSL 遍历) + 程序化 HDRI 环境贴图
// 零外部依赖。

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
if (!gl) { alert('你的浏览器不支持 WebGL2'); throw new Error('no webgl2'); }
const extCBF = gl.getExtension('EXT_color_buffer_float');
if (!extCBF) { alert('需要 EXT_color_buffer_float 扩展'); }

// ---------- 着色器 ----------
const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const PT_FRAG = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;
in vec2 vUv;

uniform sampler2D uPrev;
uniform sampler2D uTris;     // 三角形数据 (RGBA32F, 每三角形 5 texel)
uniform sampler2D uBVH;      // BVH 节点 (RGBA32F, 每节点 2 texel)
uniform vec2  uRes;
uniform int   uSamples;
uniform int   uMaxBounces;
uniform int   uScene;
uniform int   uHasMesh;
uniform float uEnv;          // 环境光强度
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFov;
uniform float uFisheye;     // 鱼眼相机：桶形径向畸变强度(0=无, 1=强鱼眼)
uniform float uPointOn;     // 解析点光源开关(0=关, >0.5 开)
uniform vec3  uPointPos;    // 解析点光源位置(世界空间)
uniform vec3  uPointColor;  // 解析点光源颜色(线性 RGB)
uniform float uPointInt;    // 解析点光源强度(反向平方衰减)
uniform float uTime;
uniform int   uFrame;       // 累积帧号（黄金比渐进采样用，逐帧变化）
uniform float uFocus;       // 对焦距离
uniform float uAperture;    // 光圈半径（0 = 关闭景深）
uniform vec3  uSunDir;      // 太阳方向（单位向量，由方位角/高度角计算，影响天空太阳盘与雾照明）
uniform float uSunInt;      // 太阳强度（0 = 无太阳盘/辉光，默认 1）
uniform float uRough;       // 金属粗糙度（0 = 镜面，1 = 宽瓣模糊反射，GGX 风格微面元近似）
uniform float uFog;         // 体积雾密度（0 = 关闭）
uniform vec3  uFogColor;     // 雾颜色（线性 RGB，默认淡蓝灰）
uniform vec3  uBgTop;        // 天空顶色（zenith，线性 RGB）
uniform vec3  uBgBottom;     // 天空底色（horizon，线性 RGB）
uniform float uRR;          // 俄罗斯轮盘提前终止（0 = 关闭）
uniform float uNEE;         // 直接光采样 NEE（0 = 关闭，回退纯路径追踪）
uniform float uJitter;      // 黄金比渐进采样强度(0=关闭, 1=像素内全幅抖动, 逐帧在像素内偏移主射线)
uniform int   uDebug;        // 调试视图：0=成品(beauty) 1=反照率(albedo) 2=法线(normal) 3=景深(depth)
uniform float uClamp;        // 萤火虫钳制：单样本辐射上限（>0 生效，0=关闭），抑制爆点噪声

#define TRI_W 1024
#define NODE_W 1024
#define LEAF_MAX 8

// ---- RNG (PCG) ----
uint rngState;
uint pcg(inout uint s){
  s = s*747796405u + 2891336453u;
  uint w = ((s >> ((s>>28u)+4u)) ^ s) * 277803737u;
  return (w>>22u) ^ w;
}
float rnd(){ return float(pcg(rngState)) / 4294967296.0; }
vec3 randUnit(){
  float z = rnd()*2.0-1.0;
  float a = rnd()*6.2831853;
  float r = sqrt(max(0.0,1.0-z*z));
  return vec3(r*cos(a), r*sin(a), z);
}
vec2 randDisk(){
  float a = rnd()*6.2831853;
  float r = sqrt(rnd());
  return vec2(cos(a), sin(a)) * r;
}

const float PI = 3.14159265;
const float EPS = 0.001;

// 材质: 0 漫反射 1 金属 2 玻璃 3 自发光
struct Hit { float t; vec3 p; vec3 n; vec3 albedo; vec3 emission; int mat; bool hit; };

float sdSphere(vec3 o, vec3 d, vec3 c, float r){
  vec3 oc = o-c; float b = dot(oc,d); float cc = dot(oc,oc)-r*r;
  float h = b*b-cc; if(h<0.0) return -1.0; return -b-sqrt(h);
}
float sdPlane(vec3 o, vec3 d, float y){
  if(abs(d.y)<1e-6) return -1.0; float t = (y-o.y)/d.y; return t>EPS? t : -1.0;
}

// ---- 三角形数据读取 ----
void fetchTri(int i, out vec3 v0, out vec3 v1, out vec3 v2, out vec3 n, out vec3 albedo, out int mat){
  int b0 = i*5;
  vec4 a = texelFetch(uTris, ivec2(b0%TRI_W, b0/TRI_W), 0);
  vec4 b = texelFetch(uTris, ivec2((b0+1)%TRI_W, (b0+1)/TRI_W), 0);
  vec4 c = texelFetch(uTris, ivec2((b0+2)%TRI_W, (b0+2)/TRI_W), 0);
  vec4 d = texelFetch(uTris, ivec2((b0+3)%TRI_W, (b0+3)/TRI_W), 0);
  vec4 e = texelFetch(uTris, ivec2((b0+4)%TRI_W, (b0+4)/TRI_W), 0);
  v0=a.xyz; v1=b.xyz; v2=c.xyz; n=d.xyz; albedo=e.xyz; mat=int(e.w+0.5);
}
bool hitTri(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2, out float t, out vec3 nrm){
  vec3 e1=v1-v0, e2=v2-v0;
  vec3 p=cross(rd,e2);
  float det=dot(e1,p);
  if(abs(det)<1e-9) return false;
  float inv=1.0/det;
  vec3 tt=ro-v0;
  float u=dot(tt,p)*inv;
  if(u<0.0||u>1.0) return false;
  vec3 q=cross(tt,e1);
  float v=dot(rd,q)*inv;
  if(v<0.0||u+v>1.0) return false;
  t=dot(e2,q)*inv;
  if(t<EPS) return false;
  nrm=normalize(cross(e1,e2));
  return true;
}
bool hitAABB(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, float tmax){
  vec3 invd = 1.0/rd;
  vec3 t0=(bmin-ro)*invd, t1=(bmax-ro)*invd;
  vec3 ts=min(t0,t1), tb=max(t0,t1);
  float tn=max(max(ts.x,ts.y),ts.z);
  float tf=min(min(tb.x,tb.y),tb.z);
  return tf>=max(tn,0.0) && tn<tmax;
}
// 遍历 BVH，更新最近命中
void hitMesh(vec3 ro, vec3 rd, inout Hit best){
  int stack[64]; int sp=0; stack[sp++]=0;
  for(int iter=0; iter<256; iter++){
    if(sp<=0) break;
    int ni = stack[--sp];
    vec4 n0 = texelFetch(uBVH, ivec2((ni*2)%NODE_W, (ni*2)/NODE_W), 0);
    vec4 n1 = texelFetch(uBVH, ivec2((ni*2+1)%NODE_W, (ni*2+1)/NODE_W), 0);
    vec3 bmin=n0.xyz, bmax=n1.xyz;
    float leftC=n0.w, count=n1.w;
    if(!hitAABB(ro,rd,bmin,bmax,best.t)) continue;
    if(count>0.5){
      int start=int(leftC), cnt=int(count);
      for(int i=0;i<LEAF_MAX;i++){
        if(i>=cnt) break;
        vec3 v0,v1,v2,n,albedo; int mat;
        fetchTri(start+i,v0,v1,v2,n,albedo,mat);
        float t; vec3 nn;
        if(hitTri(ro,rd,v0,v1,v2,t,nn) && t<best.t){
          best.t=t; best.hit=true; best.p=ro+rd*t;
          best.n = dot(nn,rd)<0.0? nn : -nn;
          best.albedo=albedo; best.mat=mat; best.emission=vec3(0);
        }
      }
    } else {
      stack[sp++]=int(leftC);
      stack[sp++]=int(leftC)+1;
    }
  }
}

// 平面求交：平面 n·x = d，返回 t（>EPS 才有效）
float planeT(vec3 ro, vec3 rd, vec3 n, float d){
  float den = dot(n, rd);
  if(abs(den) < 1e-6) return -1.0;
  float t = (d - dot(n, ro)) / den;
  return t > EPS ? t : -1.0;
}
// 轴对齐盒求交（iq 经典实现），返回进入/离开 t 与 outward 法线
bool boxIntersect(vec3 ro, vec3 rd, vec3 c, vec3 h, out float t, out vec3 n){
  vec3 m = 1.0/rd;
  vec3 nn = m*(ro - c);
  vec3 k = abs(m)*h;
  vec3 t1 = -nn - k;
  vec3 t2 = -nn + k;
  float tN = max(max(t1.x, t1.y), t1.z);
  float tF = min(min(t2.x, t2.y), t2.z);
  if(tN > tF || tF < 0.0) return false;
  t = tN > EPS ? tN : tF;
  n = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  return true;
}

// SDF 圆环(torus)：轴为局部 Y，major=R, minor=r，整体绕 X 轴倾斜 a 弧度（用于行星环）
float sdTorusD(vec3 p, vec3 c, float R, float r, float a){
  vec3 q = p - c;
  float ca = cos(a), sa = sin(a);
  q = vec3(q.x, ca*q.y - sa*q.z, sa*q.y + ca*q.z);   // 绕 X 倾斜
  vec2 t = vec2(length(q.xz) - R, q.y);
  return length(t) - r;
}
// 圆环光线步进(球体追踪)：返回命中 t(>0)，法线写入 n；未命中返回 -1
float marchTorus(vec3 ro, vec3 rd, vec3 c, float R, float r, float a, out vec3 n){
  float t = 0.02;
  for(int i=0;i<128;i++){
    vec3 p = ro + rd*t;
    float d = sdTorusD(p, c, R, r, a);
    if(d < 5e-4){
      float e = 1e-3;
      vec3 g = vec3(
        sdTorusD(p+vec3(e,0,0),c,R,r,a) - sdTorusD(p-vec3(e,0,0),c,R,r,a),
        sdTorusD(p+vec3(0,e,0),c,R,r,a) - sdTorusD(p-vec3(0,e,0),c,R,r,a),
        sdTorusD(p+vec3(0,0,e),c,R,r,a) - sdTorusD(p-vec3(0,0,e),c,R,r,a));
      // R2 防御：退化梯度(长度≈0)时回退为反向射线法线，避免 normalize(0) 产生 NaN
      n = (length(g) < 1e-6) ? -rd : normalize(g);
      return t;
    }
    t += d;
    if(t > 60.0) break;
  }
  return -1.0;
}

// 场景：返回最近命中
Hit scene(vec3 ro, vec3 rd){
  Hit best; best.hit=false; best.t=1e30;
  vec3 cols[3]; cols[0]=vec3(0.85,0.25,0.25); cols[1]=vec3(0.25,0.7,0.35); cols[2]=vec3(0.25,0.45,0.9);

  if(uScene==3){
    // 地面
    float tp = sdPlane(ro,rd,-2.0);
    if(tp>0.0 && tp<best.t){
      best.t=tp; best.hit=true; best.p=ro+rd*tp; best.n=vec3(0,1,0); best.mat=0;
      float c = mod(floor(best.p.x*0.5)+floor(best.p.z*0.5),2.0);
      best.albedo = (c<1.0)? vec3(0.10) : vec3(0.16);
    }
    // 金属球
    float t = sdSphere(ro,rd,vec3(-1.4,0.2,-0.6),0.9);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(-1.4,0.2,-0.6)); best.mat=1; best.albedo=vec3(0.95,0.92,0.85); best.emission=vec3(0); }
    // 玻璃球
    t = sdSphere(ro,rd,vec3(1.5,0.1,0.4),0.8);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(1.5,0.1,0.4)); best.mat=2; best.albedo=vec3(1.0); best.emission=vec3(0); }
    // BVH 网格（环面）
    if(uHasMesh>0) hitMesh(ro,rd,best);
    return best;
  }

  if(uScene==4){
    // ---- Cornell Box：封闭房间 + 面积光 + 两个盒子 ----
    float t; vec3 n;
    // 地面（白）
    t = planeT(ro, rd, vec3(0,1,0), -2.5);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=vec3(0,1,0); best.mat=0; best.albedo=vec3(0.73); best.emission=vec3(0); }
    // 天花板（面积光）
    t = planeT(ro, rd, vec3(0,-1,0), -2.5);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=vec3(0,-1,0); best.mat=3; best.albedo=vec3(0); best.emission=vec3(18.0); }
    // 后墙（白）
    t = planeT(ro, rd, vec3(0,0,1), -3.5);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=vec3(0,0,1); best.mat=0; best.albedo=vec3(0.73); best.emission=vec3(0); }
    // 左墙（红）
    t = planeT(ro, rd, vec3(1,0,0), -2.5);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=vec3(1,0,0); best.mat=0; best.albedo=vec3(0.75,0.18,0.16); best.emission=vec3(0); }
    // 右墙（绿）
    t = planeT(ro, rd, vec3(-1,0,0), -2.5);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=vec3(-1,0,0); best.mat=0; best.albedo=vec3(0.18,0.6,0.22); best.emission=vec3(0); }
    // 内部盒子 A（漫反射白，立在地）
    float tb; vec3 nb;
    if(boxIntersect(ro, rd, vec3(-1.0,-1.8,-0.5), vec3(0.8,0.7,0.8), tb, nb) && tb<best.t){
      best.t=tb; best.hit=true; best.p=ro+rd*tb; best.n=nb; best.mat=0; best.albedo=vec3(0.85); best.emission=vec3(0);
    }
    // 内部盒子 B（金属）
    if(boxIntersect(ro, rd, vec3(1.0,-1.4,0.8), vec3(0.7,1.1,0.7), tb, nb) && tb<best.t){
      best.t=tb; best.hit=true; best.p=ro+rd*tb; best.n=nb; best.mat=1; best.albedo=vec3(0.95); best.emission=vec3(0);
    }
    return best;
  }

  if(uScene==5){
    // ---- 彩球墙：6x4 漫反射彩球 + 顶部面光源 ----
    float tp = sdPlane(ro, rd, -2.0);
    if(tp>0.0 && tp<best.t){
      best.t=tp; best.hit=true; best.p=ro+rd*tp; best.n=vec3(0,1,0); best.mat=0;
      float c = mod(floor(best.p.x*0.5)+floor(best.p.z*0.5),2.0);
      best.albedo = (c<1.0)? vec3(0.12) : vec3(0.18);
    }
    for(int i=0;i<6;i++){
      for(int j=0;j<4;j++){
        vec3 ctr = vec3(-3.75 + float(i)*1.5, -1.2 + float(j)*1.5, -2.5);
        float t = sdSphere(ro, rd, ctr, 0.6);
        if(t>0.0 && t<best.t){
          best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-ctr); best.mat=0;
          best.albedo = 0.5 + 0.5*cos(vec3(0.0, 2.1, 4.2) + float(i*4 + j)*0.55);
        }
      }
    }
    float tl = sdSphere(ro, rd, vec3(0.0,5.0,0.0), 1.4);
    if(tl>0.0 && tl<best.t){ best.t=tl; best.hit=true; best.p=ro+rd*tl; best.n=normalize(best.p-vec3(0.0,5.0,0.0)); best.mat=3; best.albedo=vec3(0); best.emission=vec3(16.0); }
    return best;
  }

  if(uScene==6){
    // ---- 玻璃/金属厅：金属背墙 + 玻璃/金属球阵 + 长条面光源 ----
    float tp = sdPlane(ro, rd, -2.0);
    if(tp>0.0 && tp<best.t){ best.t=tp; best.hit=true; best.p=ro+rd*tp; best.n=vec3(0,1,0); best.mat=0;
      float c = mod(floor(best.p.x*0.5)+floor(best.p.z*0.5),2.0); best.albedo=(c<1.0)?vec3(0.10):vec3(0.15); }
    float tw = planeT(ro, rd, vec3(0,0,1), -4.0);
    if(tw>0.0 && tw<best.t){ best.t=tw; best.hit=true; best.p=ro+rd*tw; best.n=vec3(0,0,1); best.mat=1; best.albedo=vec3(0.9); }
    for(int i=0;i<4;i++){
      float x = -2.4 + float(i)*1.6;
      vec3 ctr = vec3(x, -0.6, -1.2);
      float t = sdSphere(ro, rd, ctr, 0.7);
      if(t>0.0 && t<best.t){
        best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-ctr);
        if(i % 2 == 0){ best.mat=2; best.albedo=vec3(1.0); }
        else { best.mat=1; best.albedo=vec3(0.95,0.92,0.85); }
      }
    }
    float tl = sdSphere(ro, rd, vec3(0.0,4.0,0.0), 2.0);
    if(tl>0.0 && tl<best.t){ best.t=tl; best.hit=true; best.p=ro+rd*tl; best.n=normalize(best.p-vec3(0.0,4.0,0.0)); best.mat=3; best.albedo=vec3(0); best.emission=vec3(14.0); }
    return best;
  }

  if(uScene==7){
    // ---- 宇宙星云：气态巨行星 + 金属卫星 + 体积星云环境(spaceEnv) ----
    float tp7 = sdPlane(ro, rd, -2.0);   // 远处星尘地平面(弱反射)
    if(tp7>0.0 && tp7<best.t){ best.t=tp7; best.hit=true; best.p=ro+rd*tp7; best.n=vec3(0,1,0); best.mat=0; best.albedo=vec3(0.04,0.04,0.06); best.emission=vec3(0); }
    float tg = sdSphere(ro, rd, vec3(-1.6,-0.4,-3.2), 2.3);
    if(tg>0.0 && tg<best.t){ best.t=tg; best.hit=true; best.p=ro+rd*tg; best.n=normalize(best.p-vec3(-1.6,-0.4,-3.2)); best.mat=0;
      float band = 0.5+0.5*sin(best.p.y*2.6 + sin(best.p.x*1.3)*0.6);   // 气态带状纹理
      best.albedo = mix(vec3(0.45,0.32,0.22), vec3(0.80,0.62,0.42), band);
      best.emission=vec3(0); }
    float tm = sdSphere(ro, rd, vec3(2.6,1.1,-1.8), 0.7);
    if(tm>0.0 && tm<best.t){ best.t=tm; best.hit=true; best.p=ro+rd*tm; best.n=normalize(best.p-vec3(2.6,1.1,-1.8)); best.mat=1; best.albedo=vec3(0.92,0.9,0.85); best.emission=vec3(0); }
    return best;
  }

  if(uScene==8){
    // ---- 行星与环：中心行星(金属) + 倾斜 SDF 圆环(行星环) ----
    float tp8 = sdPlane(ro, rd, -2.0);
    if(tp8>0.0 && tp8<best.t){ best.t=tp8; best.hit=true; best.p=ro+rd*tp8; best.n=vec3(0,1,0); best.mat=0; best.albedo=vec3(0.05,0.05,0.07); best.emission=vec3(0); }
    vec3 planet = vec3(0.0, 0.0, -3.6);
    float tg = sdSphere(ro, rd, planet, 2.1);
    if(tg>0.0 && tg<best.t){ best.t=tg; best.hit=true; best.p=ro+rd*tg; best.n=normalize(best.p-planet); best.mat=2; best.albedo=vec3(1.0); best.emission=vec3(0); }
    vec3 rn;
    float tt = marchTorus(ro, rd, planet, 3.4, 0.55, 0.5, rn);
    if(tt>0.0 && tt<best.t){ best.t=tt; best.hit=true; best.p=ro+rd*tt; best.n=rn; best.mat=0;
      float rad = length((best.p - planet).xz);
      best.albedo = mix(vec3(0.55,0.5,0.4), vec3(0.88,0.82,0.7), 0.5+0.5*sin(rad*7.0));   // 环带明暗条纹
      best.emission=vec3(0); }
    return best;
  }

  // 地面
  float tp = sdPlane(ro,rd,-2.0);
  if(tp>0.0 && tp<best.t){
    best.t=tp; best.hit=true; best.p=ro+rd*tp; best.n=vec3(0,1,0); best.mat=0;
    float c = mod(floor(best.p.x)+floor(best.p.z),2.0);
    best.albedo = (c<1.0)? vec3(0.16) : vec3(0.62);
  }
  if(uScene==0){
    float t = sdSphere(ro,rd,vec3(-1.25,0.0,-0.4),1.0);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(-1.25,0.0,-0.4)); best.mat=1; best.albedo=vec3(0.95); best.emission=vec3(0); }
    t = sdSphere(ro,rd,vec3(1.25,0.0,0.4),1.0);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(1.25,0.0,0.4)); best.mat=2; best.albedo=vec3(1.0); best.emission=vec3(0); }
    t = sdSphere(ro,rd,vec3(-2.6,-1.2,1.6),0.8);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(-2.6,-1.2,1.6)); best.mat=0; best.albedo=vec3(0.85,0.25,0.25); best.emission=vec3(0); }
    t = sdSphere(ro,rd,vec3(2.6,-1.2,1.6),0.8);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(2.6,-1.2,1.6)); best.mat=0; best.albedo=vec3(0.25,0.7,0.35); best.emission=vec3(0); }
  } else if(uScene==1){
    for(int i=0;i<3;i++){
      for(int j=0;j<3;j++){
        float x = -2.4 + float(i)*2.4;
        float z = -1.0 + float(j)*2.0;
        float t = sdSphere(ro,rd,vec3(x,0.0,z),0.85);
        if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(x,0.0,z));
          best.mat=0; best.albedo=cols[(i+j)%3]; best.emission=vec3(0); }
      }
    }
  } else {
    float t = sdSphere(ro,rd,vec3(0.0,0.4,0.0),0.6);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(0.0,0.4,0.0)); best.mat=3; best.albedo=vec3(0); best.emission=vec3(14.0,11.0,7.0); }
    t = sdSphere(ro,rd,vec3(2.2,-1.4,2.0),0.7);
    if(t>0.0 && t<best.t){ best.t=t; best.hit=true; best.p=ro+rd*t; best.n=normalize(best.p-vec3(2.2,-1.4,2.0)); best.mat=2; best.albedo=vec3(1.0); best.emission=vec3(0); }
  }
  // 顶部面光源
  float tl = sdSphere(ro,rd,vec3(0.0,4.5,0.0),1.1);
  if(tl>0.0 && tl<best.t){ best.t=tl; best.hit=true; best.p=ro+rd*tl; best.n=normalize(best.p-vec3(0.0,4.5,0.0)); best.mat=3; best.albedo=vec3(0); best.emission=vec3(18.0); }

  return best;
}

// 程序化 HDRI 风格环境贴图（渐变天空 + 太阳 + 地面）
vec3 sky(vec3 d){
  float y = d.y;
  vec3 zenith = uBgTop;
  vec3 horizon = uBgBottom;
  vec3 ground = vec3(0.10,0.09,0.085);
  vec3 col;
  if(y>0.0) col = mix(horizon, zenith, pow(clamp(y,0.0,1.0),0.5));
  else col = mix(horizon, ground, pow(clamp(-y,0.0,1.0),0.4));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(22.0,18.0,13.0) * uSunInt * pow(s, 1500.0);   // 太阳盘（强度可调）
  col += vec3(0.8,0.7,0.55) * uSunInt * pow(s, 6.0);        // 太阳辉光（强度可调）
  return col * uEnv;
}

// 3D 值噪声 + FBM（用于星云体积纹理）
float hash31(vec3 p){
  p = fract(p*0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  float n000=hash31(i+vec3(0,0,0)), n100=hash31(i+vec3(1,0,0));
  float n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1));
  float n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm3(vec3 p){
  float s=0.0, a=0.5;
  for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; }
  return s;
}
// 宇宙星云环境：方向采样 FBM 彩色云气 + 哈希星点（场景 7 专用，调用处乘 uEnv 与 sky 一致）
vec3 spaceEnv(vec3 rd){
  vec3 p = rd*2.6;
  float n  = fbm3(p);
  float n2 = fbm3(p*1.9 + 13.1);
  vec3 col = mix(vec3(0.05,0.02,0.11), vec3(0.55,0.12,0.5), n);   // 紫→品红云气
  col += vec3(0.04,0.13,0.34) * n2;                                // 蓝色辉光
  col *= 0.4 + 1.6*smoothstep(0.30, 0.95, n + 0.35*n2);            // 云气对比
  vec3 sp = rd*260.0; vec3 ip = floor(sp); vec3 fp = fract(sp)-0.5;
  float starR = hash31(ip+3.7);
  col += vec3(1.0,0.96,0.9) * smoothstep(0.5,0.0,length(fp)) * step(0.988, starR) * 7.0;  // 稀疏星点
  col += vec3(0.012,0.012,0.022);                                  // 深空底色
  return col;
}

// 直接光采样（NEE / next-event estimation）：在漫反射命中点朝“面光源”（有限球光源）采样一点，
// 发阴影射线判断是否被遮挡，未被遮挡则按面积采样 pdf 计入直接光照，显著降低蒙特卡洛噪声。
// 仅对场景 2/5/6 的有限球光源生效（其余场景无面光源，返回 0——仍由天空/反弹提供照明，不重复计）。
vec3 neeDirect(vec3 p, vec3 n, vec3 albedo){
  vec3 C; float R; vec3 Le; bool ok = false;
  if(uScene==2){ C=vec3(0.0,4.5,0.0); R=1.1; Le=vec3(18.0); ok=true; }
  else if(uScene==5){ C=vec3(0.0,5.0,0.0); R=1.4; Le=vec3(16.0); ok=true; }
  else if(uScene==6){ C=vec3(0.0,4.0,0.0); R=2.0; Le=vec3(14.0); ok=true; }
  if(!ok) return vec3(0.0);
  vec3 lp = C + randUnit() * R;            // 球面均匀采样一点
  vec3 wi = lp - p;
  float dist2 = dot(wi, wi);
  float dist = sqrt(dist2);
  wi /= dist;
  float cosS = dot(n, wi);
  if(cosS <= 0.0) return vec3(0.0);   // 接收面背向光源
  Hit sh = scene(p + n*EPS, wi);
  if(sh.hit && sh.t < dist - EPS) return vec3(0.0);  // 被遮挡
  vec3 ln = normalize(lp - C);             // 光源外法线
  float cosL = dot(ln, -wi);
  if(cosL <= 0.0) return vec3(0.0);   // 光源背面
  float pdfA = 1.0 / (4.0*PI*R*R);     // 球面均匀采样面积 pdf
  float G = cosS * cosL / dist2;
  return albedo * (1.0/PI) * Le * G / pdfA;
}

// 解析点光源：朝点光源方向采样，带阴影射线遮挡判定与反向平方衰减
vec3 pointLight(vec3 p, vec3 n, vec3 albedo){
  vec3 lp = uPointPos;
  vec3 wi = lp - p;
  float dist2 = dot(wi, wi);
  float dist = sqrt(dist2);
  wi /= dist;
  float cosS = dot(n, wi);
  if(cosS <= 0.0) return vec3(0.0);          // 接收面背向光源
  Hit sh = scene(p + n*EPS, wi);
  if(sh.hit && sh.t < dist - EPS) return vec3(0.0);  // 被遮挡 → 阴影
  float distC = max(dist, 0.05);             // R2: 近距钳制(避免 dist→0 时除零/爆点)
  float atten = 1.0 / (distC*distC);
  return albedo * (1.0/PI) * uPointColor * uPointInt * atten * cosS;
}

vec3 radiance(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0); vec3 thr = vec3(1.0);
  bool fromDiffuse = false;          // 上一 bounce 是否为漫反射（用于避免 NEE 与反弹双重计光）
  for(int b=0;b<uMaxBounces;b++){
    Hit h = scene(ro,rd);
    // 调试视图：仅看首条命中，跳过完整路径追踪（美容/反照率/法线/景深）
    if(b == 0 && uDebug != 0){
      if(uDebug == 1) return h.hit ? h.albedo : vec3(0.0);                 // 反照率
      else if(uDebug == 2) return h.hit ? h.n*0.5+0.5 : vec3(0.0);         // 法线
      else if(uDebug == 3) return vec3(clamp(h.hit ? h.t/12.0 : 1.0, 0.0, 1.0)); // 景深(归一化)
    }
    // 体积雾：按段长衰减贡献并叠加天空照亮的雾
    float seg = h.hit ? h.t : 1e9;
    if(uFog > 0.0001){
      float fogA = 1.0 - exp(-uFog * seg);
      vec3 fogCol = uFogColor;
      L += thr * fogCol * fogA;
      thr *= (1.0 - fogA);
      if(!h.hit){ break; }
    } else if(!h.hit){ L += thr*(uScene==7 ? spaceEnv(rd)*uEnv : sky(rd)); break; }
    // 命中面光源：NEE 已覆盖的有限球光源（场景 2/5/6）在漫反射 bounce 上跳过，避免重复计光；
    // 其余场景（如 Cornell 无限平面光）仍由反弹直接照亮，不跳过。
    if(h.mat==3){
      bool neeLit = (uScene==2 || uScene==5 || uScene==6);
      if(!fromDiffuse || !neeLit) L += thr*h.emission;
      break;
    }
    // 直接光采样（NEE）：漫反射命中点朝面光源采样，显著降低噪声
    if(uNEE > 0.5 && h.mat==0){ L += thr * neeDirect(h.p, h.n, h.albedo); }
    // 解析点光源：漫反射命中点朝点光源方向累积直接光照(含阴影)
    if(uPointOn > 0.5 && h.mat==0){ L += thr * pointLight(h.p, h.n, h.albedo); }
    thr *= h.albedo;
    // 俄罗斯轮盘：深度足够后按吞吐概率提前终止低贡献路径（同等开销采样更多路径 → 效率提升）
    if(uRR > 0.5 && b > 3){
      float q = 1.0 - clamp(max(thr.r, max(thr.g, thr.b)), 0.0, 1.0);
      if(rnd() < q) break;
      thr /= max(1.0 - q, 1e-3);
    }
    if(h.mat==1){

      vec3 r = reflect(rd,h.n);
      // 金属粗糙度 uRough：0=镜面，1=宽瓣模糊反射（GGX 风格微面元近似，扰动幅度 mix(0.04,1.2,uRough)）
      vec3 lobe = randUnit() * mix(0.04, 1.2, uRough);
      rd = normalize(r + lobe);
      ro = h.p + h.n*EPS;
      fromDiffuse = false;          // 镜面反弹：后续若命中面光源仍计入直接光
    } else if(h.mat==2){
      bool into = dot(rd,h.n)<0.0;
      vec3 n = into? h.n : -h.n;
      float eta = into? (1.0/1.5) : 1.5;
      float cosI = -dot(rd,n);
      float k = 1.0 - eta*eta*(1.0-cosI*cosI);
      float R0 = (1.5-1.0)/(1.5+1.0); R0=R0*R0;
      float R = R0 + (1.0-R0)*pow(1.0-cosI,5.0);
      if(k<0.0 || rnd()<R){ rd = reflect(rd,n); }
      else { rd = normalize(refract(rd,n,eta)); }
      ro = h.p + n*EPS* (into?1.0:-1.0);
      fromDiffuse = false;          // 折射反弹：同上
    } else {
      vec3 up = abs(h.n.z)<0.999? vec3(0,0,1):vec3(1,0,0);
      vec3 t = normalize(cross(up,h.n));
      vec3 b = cross(h.n,t);
      float r1=rnd(), r2=rnd();
      float ph=6.2831853*r1, r=sqrt(r2);
      vec3 dir = normalize(t*(r*cos(ph)) + b*(r*sin(ph)) + h.n*sqrt(max(0.0,1.0-r2)));
      rd = dir; ro = h.p + h.n*EPS;
      fromDiffuse = true;           // 漫反射反弹：后续命中面光源由 NEE 覆盖，不重复计
    }
  }
  if(uClamp > 0.0) L = min(L, vec3(uClamp));   // 萤火虫钳制：单样本辐射上限，抑制爆点噪声
  return L;
}

void main(){
  rngState = uint(gl_FragCoord.x)*1973u + uint(gl_FragCoord.y)*9277u + uint(uTime*60.0)*26699u + 1u;
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
  // 鱼眼相机：桶形径向畸变(uFisheye)，边缘光线向外扩张形成球面膨胀感
  if(uFisheye > 0.0){
    float r = length(uv);
    float rr = r * (1.0 + uFisheye * 0.65 * r * r);   // 随半径二次扩张
    uv = (r > 1e-5) ? uv * (rr / r) : uv;
  }
  // 黄金比(R2 低差异二维序列)渐进采样：逐帧在像素内偏移主射线，
  // 多帧累积的 AA 噪点分布更均匀、收敛更快（uJitter=0 关闭）。
  if(uJitter > 0.0){
    vec2 r2 = fract(vec2(0.7548776662, 0.5698402909) * float(uFrame + 1));
    vec2 jp = (r2 - 0.5) * uJitter;
    uv.x += jp.x * (2.0 / uRes.x);
    uv.y += jp.y * (2.0 / uRes.y);
  }
  float tf = tan(uFov*0.5);
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamFwd + uv.x*tf*uCamRight + uv.y*tf*uCamUp);
  if(uAperture > 0.0){
    // 薄透镜近似：抖动射线原点，使对焦平面保持清晰
    vec2 lens = randDisk() * uAperture;
    vec3 focusPoint = uCamPos + rd * uFocus;
    ro = uCamPos + lens.x*uCamRight + lens.y*uCamUp;
    rd = normalize(focusPoint - ro);
  }
  vec3 L = radiance(ro, rd);
  vec3 prev = texture(uPrev, vUv).rgb;
  outColor = vec4(prev + L, 1.0);
}`;

const SHOW_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
in vec2 vUv;
uniform sampler2D uAccum;
uniform int   uSamples;
uniform float uExposure;
uniform int   uTone;
uniform int   uDenoise;    // 0 关闭 1 开启 A-trous 边缘感知降噪
uniform int   uDenIters;   // 小波迭代次数 (1..5)
uniform vec2  uTexSize;    // 累积缓冲分辨率(像素)
uniform int   uBloom;      // 0 关闭 1 开启 泛光后处理
uniform float uBloomStr;   // 泛光强度(加性叠加系数)
uniform float uBloomThr;   // 亮度阈值(超出部分才泛光, soft-knee)
uniform int   uVignette;   // 0 关闭 1 开启 暗角后处理
uniform float uVigStr;     // 暗角强度(0=无, 1=边角全黑)
uniform float uGamma;      // 显示 gamma 校正（2.2≈标准 sRGB 观感，1=线性不变，<1 压暗，>1 提亮暗部）
uniform int   uChroma;     // 0 关闭 1 开启 色差(Chromatic Aberration)后处理
uniform float uChromaStr;  // 色差强度(0=无, 1=边缘最大偏移约 3%)
uniform float uChromaAmt;   // 色差强度(ChromaAmt)：径向 RGB 分离量, 0=无 1=边缘最大偏移约 5%
uniform int   uGrain;      // 0 关闭 1 开启 胶片噪点(模拟胶片颗粒感)
uniform float uGrainStr;   // 噪点强度(0=无, ~0.15 明显颗粒)
uniform float uFrame;      // 累积帧号(供噪点逐帧变化)
uniform float uSatStr;     // 饱和度(1=原色, >1 增饱和, <1 去饱和)
uniform float uContrast;   // 对比度(1=原图, >1 增对比, <1 减对比)
uniform float uSharpen;    // 锐化(非锐化掩膜: 中心减 4 邻域均值再叠加, 0=关闭, >0 增强边缘)
uniform float uDither;     // 有序抖动(4x4 Bayer): 向颜色注入半阶量化噪声打散渐变条带, 0=关闭
uniform float uTemp;       // 色温/白平衡(0=原色, >0 偏暖增红减蓝, <0 偏冷增蓝减红)
uniform float uHue;       // 色相旋转(度, -180..180, 0=原色, 围绕 H 轴旋转整体色相)
uniform float uHueShift;   // 色相旋转(HueShift)：HSV 空间旋转 H 通道(度, -180..180), 0=原色
uniform float uSepia;      // 复古褐调强度(0=原色, 1=满褐, 经典 sepia 矩阵混合)
uniform float uPosterize;  // 色调分层(色阶)级别数(0/1=关闭, >=2 时把每通道量化为 N 级)
uniform float uLetterbox; // 电影黑边：每条黑边占画面高度的比例(0=关闭, 0.1=上下各 10% 黑边)
uniform float uScanline; // CRT 扫描线强度(0=关闭, 1=最深；模拟老式显像管横向暗线)
uniform float uInvert;   // 反相/负片强度(0=原色, 1=完全反相, 经典暗房负片效果)
uniform float uBorder;   // 画面边框强度(0=无边框, 1=最厚相框, 四周压黑形成画框效果)
uniform float uBright;   // 亮度增益(0=不变, 1=最亮×2)：c *= (1+uBright) 并钳制到 [0,1]
uniform float uDuotone;  // 双色调：按亮度在暗部色↔高光色间映射(0=原色, 1=完全双色调)
uniform vec3  uDuotoneShadow; // 双色调暗部色(DuotoneShadow)：亮度 0 处映射到的颜色
uniform vec3  uDuotoneHigh;   // 双色调高光色(DuotoneHigh)：亮度 1 处映射到的颜色
uniform float uVibrance; // 自然饱和度：低饱和像素提拉更多，高饱和几乎不变(0=关闭, 1=最强)
uniform float uMono;     // 去色/灰度：按 Rec.709 亮度将颜色混入灰度(0=原色, 1=纯灰度)
uniform float uTint;      // 色调染色：按暖色 tint 乘以(0=无, 1=强染色)
uniform float uBalance;    // 色彩平衡：滑块 0~1 映射 b=2t-1，>0 偏暖(红增蓝减)、<0 偏冷(红减蓝增)
uniform float uBleach;     // 漂白旁路(bleach-bypass)：将颜色向半去饱和的亮度混合，电影银盐质感
uniform float uFade;       // 褪色(faded)：轻微去饱和 + 抬高黑位，复古胶片质感
uniform float uSplitTone;   // 分离色调(split-tone)：阴影染冷(青)、高光染暖(橙)
uniform float uHighlights;  // 高光压缩(highlight rolloff)：仅对超过阈值的高亮区做肩式滚降，柔和胶片肩部
uniform float uGlow;       // 柔光(bloom-lite)：仅对超阈值(0.6)的高亮区按自身色相增强，营造发光感
uniform float uSolarize;    // 色调分离(solarize)：亮度超阈值(0.5)的部分按强度反相，制造怪诞高光
uniform float uExpose;     // 曝光(expose)：按 2^t 倍率整体提亮，模拟曝光补偿
uniform float uThreshold;  // 阈值二值化(threshold)：按亮度阈值 t 将画面转为黑白
uniform float uCrossprocess; // 交叉冲印(crossprocess)：阴影染冷(蓝升红降)、高光染暖(红绿升蓝降)，模拟胶片误冲
uniform float uFalsecolor;  // 伪彩映射(falsecolor)：按亮度做热成像伪彩(ironbow)，0=原图 1=全伪彩
uniform float uGradientmap; // 渐变映射(gradientmap)：按亮度做日落渐变映射(深蓝→绯红→金黄)，0=原图 1=全映射
uniform float uPastel;     // 粉彩(pastel)：去饱和后向白提亮，营造柔和粉彩/水彩质感，0=原图 1=全粉彩
uniform float uInfrared;   // 红外假彩(infrared)：按亮度做热成像伪彩映射(黑→紫→红→橙→黄→白)，0=原图 1=全映射
uniform float uRadial;     // 径向色相(radial)：色相随到画面中心的径向距离旋转，0=原图 1=全旋转
uniform float uSwirl;      // 漩涡色相(swirl)：色相随半径渐进旋转（漩涡/扭曲感），0=原图 1=全旋转
uniform float uNight;      // 夜视绿(night)：去色转绿单色 + 轻微提亮/对比，0=原图 1=全夜视
uniform float uEmboss;     // 浮雕(emboss)：用 dFdx/dFdy 导数做方向性浮雕，0=原图 1=全浮雕
uniform float uEdge;       // 边缘检测(edge)：用 dFdx/dFdy 计算亮度梯度幅值做边缘，0=原图 1=全边缘
uniform float uPixelate;   // 像素化(pixelate)：把 UV 量子化到方块，重采样得到马赛克，0=原图 1=全像素化
uniform float uPixelSize;  // 像素化尺寸(PixelSize)：控制马赛克方块粗细, 0=细 1=极粗
uniform float uRgbshift;   // RGB 偏移(rgbshift)：R/B 通道水平错位（色散），0=原图 1=全偏移
uniform float uHalftone;   // 半调网点(halftone)：按亮度做圆形点阵抖动，0=原图 1=满半调
uniform float uTechni;     // 三色染印(Technicolor)：去饱和后按亮度在青绿/红橙/暖黄三段映射，0=原图 1=满映射
uniform float uVhs;        // VHS 录像带失真：横向色偏 + 跟踪抖动 + 磁带噪点，0=原图 1=满失真
uniform float uColorkey;   // 色度键控/绿幕抠像：靠近关键色(绿)的像素被压暗抠除，0=关闭 1=最强
uniform float uAnaglyph;  // 红蓝立体(Anaglyph)：左右眼由水平错位采样模拟, 红=左 青=右，0=关闭 1=最强
uniform float uOil;       // 油画(Oil)：邻域分箱取众数亮度桶平均色, 0=原图 1=满油画
uniform float uLomo;      // Lomo：暗角 + 冷暖色偏 + 提饱和, 0=原图 1=满 Lomo
uniform float uLeak;      // 漏光(Light Leak)：角落彩色辉光, 0=无 1=最强
uniform float uWave;      // 波形畸变(Wave)：水平正弦行偏移, 0=无 1=最强
uniform float uCnoise;    // 彩色噪点(Color Noise)：每像素彩色颗粒, 0=无 1=最强
uniform float uKaleido;   // 万花筒(Kaleidoscope)：楔形镜像重采样, 0=无 1=满
uniform float uRipple;    // 水波纹(Ripple)：径向正弦位移, 0=无 1=最强
uniform float uHuequant;  // 色相分层(Hue Quantize)：量化色相到 N 档, 0=原图 1=最强
uniform float uLift;      // 暗部提升(Lift Shadows)：抬升暗部, 0=无 1=最强
uniform float uHsat;      // 高光饱和(Highlight Sat)：仅高光区提饱和, 0=无 1=最强
uniform float uGlitch;     // 故障艺术(Glitch)：条带水平错位 + RGB 抖动 + 偶发反相, 0=无 1=最强
uniform float uCyanotype;  // 蓝晒(Cyanotype)：按亮度映射到普鲁士蓝→纸白单色调, 0=原图 1=满蓝晒
uniform float uSelenium;   // 硒调(Selenium)：暗房硒盐调色, 阴影染紫褐/中间调轻染/高光保持中性, 0=原图 1=满硒调
uniform float uMoonlight;  // 月光(Moonlight)：冷银蓝单色 + 压暗高光, 模拟月夜曝光, 0=原图 1=满月光
uniform float uVerdigris;  // 铜绿(Verdigris)：铜锈青绿色调映射, 暗部深铜褐/亮部青绿锈, 0=原图 1=满铜绿
uniform float uRosegold;   // 玫瑰金(Rose Gold)：暖粉金色调, 高光染粉金/阴影暖褐, 0=原图 1=满玫瑰金
uniform float uAurora;     // 极光(Aurora)：亮度驱动绿→青→紫渐变映射, 模拟极光帷幕, 0=原图 1=满极光
uniform float uAmber;      // 琥珀(Amber)：琥珀单色调, 深棕(暗)→琥珀橙(中)→蜜黄(亮), 0=原图 1=满琥珀
uniform float uWatercolor;  // 水彩(Watercolor)：湿边扩散 + 纸纹噪声微扰, 0=原图 1=满水彩
vec3 falseColor(float l){
  l = clamp(l, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(0.25, 0.0, 0.45);
  vec3 c2 = vec3(0.85, 0.10, 0.20);
  vec3 c3 = vec3(1.0, 0.55, 0.05);
  vec3 c4 = vec3(1.0, 1.0, 0.95);
  if(l < 0.25) return mix(c0, c1, l / 0.25);
  if(l < 0.50) return mix(c1, c2, (l - 0.25) / 0.25);
  if(l < 0.75) return mix(c2, c3, (l - 0.50) / 0.25);
  return mix(c3, c4, (l - 0.75) / 0.25);
}
vec3 gradientMap(float l){
  l = clamp(l, 0.0, 1.0);
  vec3 s0 = vec3(0.10, 0.16, 0.42);   // 阴影：深蓝
  vec3 s1 = vec3(0.70, 0.12, 0.12);   // 中间：绯红
  vec3 s2 = vec3(0.99, 0.73, 0.18);   // 高光：金黄
  if(l < 0.5) return mix(s0, s1, l / 0.5);
  return mix(s1, s2, (l - 0.5) / 0.5);
}
vec3 infraredMap(float l){                             // 热成像伪彩：黑→深紫→红→橙→黄→白
  l = clamp(l, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(0.30, 0.0, 0.40);
  vec3 c2 = vec3(0.85, 0.05, 0.10);
  vec3 c3 = vec3(1.0, 0.55, 0.0);
  vec3 c4 = vec3(1.0, 0.95, 0.6);
  vec3 c5 = vec3(1.0, 1.0, 1.0);
  if(l < 0.2) return mix(c0, c1, l / 0.2);
  if(l < 0.4) return mix(c1, c2, (l - 0.2) / 0.2);
  if(l < 0.6) return mix(c2, c3, (l - 0.4) / 0.2);
  if(l < 0.8) return mix(c3, c4, (l - 0.6) / 0.2);
  return mix(c4, c5, (l - 0.8) / 0.2);
}
vec3 hueQuant(vec3 col, float lv){
  float mx = max(col.r, max(col.g, col.b));
  float mn = min(col.r, min(col.g, col.b));
  float c = mx - mn;
  if(c < 1e-4) return col;
  float h;
  if(mx == col.r) h = mod((col.g - col.b)/c, 6.0);
  else if(mx == col.g) h = (col.b - col.r)/c + 2.0;
  else h = (col.r - col.g)/c + 4.0;
  h /= 6.0;
  float q = floor(h * lv + 0.5) / lv;
  float sat = c / max(mx, 1e-4);
  vec3 rgb = clamp(abs(mod(q*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(mx), rgb, sat);
}
vec3 aces(vec3 x){
  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
vec3 reinhard(vec3 x){ return x/(1.0+x); }
// Uncharted2 电影级 filmic 曲线（Hejl 近似算子）：s 形 shoulders，暗部提亮、高光柔和压缩
vec3 uncharted2(vec3 x){
  float A=0.15, B=0.50, C=0.10, D=0.20, E=0.02, F=0.30;
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F)) - E/F;
}
vec3 agxTonemap(vec3 x){                                     // AgX 风格紧凑曲线：对数压缩 + S 形对比 + 轻微去饱和
  x = max(x, 0.0);
  vec3 l = log2(1.0 + x * 16.0) / log2(17.0);                // 0..1 对数压缩
  l = clamp(l, 0.0, 1.0);                                  // 高光滚降为白(防 S 曲线溢出变黑)
  vec3 sm = l * l * (3.0 - 2.0 * l);                         // 平滑 S 曲线(提升对比)
  float g = dot(sm, vec3(0.299, 0.587, 0.114));
  sm = mix(vec3(g), sm, 0.92);                               // 轻微去饱和(电影感)
  return clamp(sm, 0.0, 1.0);
}
vec3 tonemap(vec3 x, int m){
  if(m==1) return reinhard(x);
  if(m==2) return clamp(x, 0.0, 1.0);   // 线性(仅裁剪)
  if(m==3) return clamp(uncharted2(x), 0.0, 1.0);
  if(m==4) return clamp(agxTonemap(x), 0.0, 1.0);   // 4 = AgX(电影感紧凑曲线)
  return clamp(aces(x), 0.0, 1.0);                  // 0 = ACES（R2: 防御性 NaN/inf 钳制）
}
// 边缘感知 A-trous 小波降噪：在累积缓冲(已取平均)上做多尺度卷积，
// 以颜色/亮度差作为边缘停止权重（无 G-buffer 时退化为亮度引导，保边去噪）。
vec3 denoiseAtrus(vec3 center, vec2 baseUv, int iters){
  vec3 c = center;
  for(int it=0; it<5; it++){
    if(it >= iters) break;
    int step = 1 << it;                       // 小波步长 1,2,4,8,16
    vec3 acc = vec3(0.0);
    float wSum = 0.0;
    for(int x=-1; x<=1; x++){
      for(int y=-1; y<=1; y++){
        vec2 off = vec2(float(x), float(y)) * float(step);
        vec2 uv = baseUv + off / uTexSize;
        vec3 cs = texture(uAccum, uv).rgb / float(max(uSamples,1));
        // 固定 3x3 小波核权重（单位步长）
        float wk = (x==0 && y==0) ? 4.0 : ((x!=0 && y!=0) ? 1.0 : 2.0);
        // 边缘停止：与中心亮度差越大权重越小 → 保边
        float cd = dot(abs(cs - c), vec3(0.299,0.587,0.114));
        float ws = wk * exp(-cd * 16.0);
        acc += cs * ws;
        wSum += ws;
      }
    }
    if(wSum > 1e-4) c = acc / wSum;
  }
  return c;
}
vec3 sampleHDR(vec2 uv){ return texture(uAccum, uv).rgb / float(max(uSamples,1)); }
// 亮度阈值提取(soft-knee)：仅保留亮度超过阈值的部分，平滑过渡不产生硬边
vec3 brightPass(vec3 c, float thr){
  float l = dot(c, vec3(0.299,0.587,0.114));
  float k = max(l - thr, 0.0) / max(l, 1e-4);   // 亮度超阈占比 ∈[0,1)
  return c * k;
}
// 泛光：对亮部做多尺度高斯模糊(在 HDR 累积图上多点采样, 步长 2/4/8 像素扩散光晕)
vec3 bloom(vec2 baseUv, float thr){
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  for(int s=0; s<3; s++){
    float step = float(1 << s);                   // 1,2,4 像素(最细尺度覆盖相邻像素, 扩散连续)
    for(int x=-2; x<=2; x++){
      for(int y=-2; y<=2; y++){
        vec2 uv = baseUv + vec2(float(x),float(y)) * step / uTexSize;
        vec3 hb = brightPass(sampleHDR(uv), thr);
        float w = exp(-float(x*x + y*y) / 4.0);   // 5x5 高斯权重
        acc += hb * w;
        wSum += w;
      }
    }
  }
  return acc / max(wSum, 1e-4);
}
// 暗角：边缘按到中心距离平方压暗；中心=1，边角=1-str（str∈[0,1]）
float vignette(vec2 uv, float str){
  vec2 d = (uv - 0.5) * 2.0;          // 映射到 [-1,1]
  float r2 = dot(d, d);                    // 0 中心 → 2 边角
  return clamp(1.0 - str * (r2 * 0.5), 0.0, 1.0);
}
// 胶片噪点：每像素基于 uv 与帧号的高频伪随机扰动，模拟胶片颗粒(逐帧变化 → 动态噪点)
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 色相旋转(Hue Shift)：RGB↔HSV 互转后平移 H 分量(度)，整体换色而不改变明度/饱和度
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(vec3(1.0), clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 hueShift(vec3 c, float deg){
  // 契约: c 已钳制到 [0,1]; deg 经 deserialize/presetToParams 钳制到 [-180,180]。
  // hsv.x(H通道) 用 fract() 保证周期性(任意 deg 都映射到 [0,1) 有效色相), 避免溢出产生异常色。
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  hsv.x = fract(hsv.x + deg / 360.0);
  return clamp(hsv2rgb(hsv), 0.0, 1.0);
}
void main(){
  vec2 texel = 1.0 / uTexSize;
  vec3 cHDR = sampleHDR(vUv);
  if(uSharpen > 0.0){                                       // 锐化：非锐化掩膜(中心减 4 邻域均值, 再叠加回中心)
    vec3 blur = (
      sampleHDR(vUv + vec2(texel.x, 0.0)) +
      sampleHDR(vUv - vec2(texel.x, 0.0)) +
      sampleHDR(vUv + vec2(0.0, texel.y)) +
      sampleHDR(vUv - vec2(0.0, texel.y))
    ) * 0.25;
    cHDR = max(cHDR + uSharpen * (cHDR - blur), 0.0);
  }
  vec3 c = cHDR;
  if(uDenoise == 1){ c = denoiseAtrus(c, vUv, uDenIters); }
  if(uBloom == 1){ c += bloom(vUv, uBloomThr) * uBloomStr; }   // 加性叠加泛光光晕
  if(uChroma == 1){                                          // 色差(ChromaticAberration)：R/B 通道沿径向偏移重采样(以 c.g 为基准); uChromaAmt=最大偏移比例, uChromaStr 调制实际强度(默认0.5→系数1.0)
    vec2 dir = vUv - 0.5;
    float amt = clamp(uChromaAmt, 0.0, 1.0) * 0.05 * (0.5 + uChromaStr);  // 修复死 uniform: uChromaStr 现已生效(矫正前仅声明/绑定却从未使用)
    vec3 r = sampleHDR(vUv - dir * amt);
    vec3 b = sampleHDR(vUv + dir * amt);
    c = vec3(r.r, c.g, b.b);
  }
  if(uGlitch > 0.0){                                          // 故障艺术：条带错位 + RGB 抖动 + 偶发反相
    float blocks = 18.0;
    float by = floor(vUv.y * blocks);
    float t = floor(uFrame * 0.05);
    float h = hash21(vec2(by, t));
    float gat = step(0.55, hash21(vec2(by * 1.7, t * 1.3)));  // 仅部分条带错位
    float shift = (h - 0.5) * uGlitch * 0.12 * gat;
    vec2 guv = vUv + vec2(shift, 0.0);
    vec3 g;
    g.r = sampleHDR(guv + vec2(uGlitch * 0.012, 0.0)).r;
    g.g = sampleHDR(guv).g;
    g.b = sampleHDR(guv - vec2(uGlitch * 0.012, 0.0)).b;
    float inv = step(0.85, hash21(vec2(by * 5.3, t * 0.9)));  // 偶发整块反相
    g = mix(g, vec3(1.0) - g, inv * uGlitch);
    c = g;
  }
  c = tonemap(c * uExposure, uTone);
  if(uTemp != 0.0){                                       // 色温/白平衡：>0 偏暖(增红减蓝)、<0 偏冷(增蓝减红)，单位幅度 0.15
    c.r = clamp(c.r * (1.0 + 0.15 * uTemp), 0.0, 1.0);
    c.b = clamp(c.b * (1.0 - 0.15 * uTemp), 0.0, 1.0);
  }
  if(uHue != 0.0){ c = hueShift(c, uHue); }             // 色相旋转：围绕 H 轴(度) 整体换色
  if(uHueShift != 0.0){ c = hueShift(c, uHueShift); }   // 色相旋转(HueShift)：HSV 空间再绕 H 轴旋转, 可与 uHue 叠加
  if(uSepia > 0.0){                                      // 复古褐调：经典 sepia 矩阵，按强度混合
    vec3 sep = vec3(dot(c, vec3(0.393, 0.769, 0.189)),
                    dot(c, vec3(0.349, 0.686, 0.168)),
                    dot(c, vec3(0.272, 0.534, 0.131)));
    c = clamp(mix(c, sep, uSepia), 0.0, 1.0);
  }
  if(uPosterize >= 2.0){                                // 色调分层：把每通道量化为 N 个离散色阶(漫画/复古点彩风)
    float inv = 1.0 / (uPosterize - 1.0);
    c = clamp(floor(c * uPosterize) * inv, 0.0, 1.0);
  }
  c = pow(c, vec3(1.0 / uGamma));                       // 可调 gamma 显示校正
  if(uVignette == 1){ c *= vignette(vUv, uVigStr); }   // 暗角：边缘压暗
  if(uSatStr != 1.0){                                     // 饱和度：对灰度插值(uSatStr=1 恒等)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = clamp(mix(vec3(l), c, uSatStr), 0.0, 1.0);
  }
  if(uContrast != 1.0){                                 // 对比度：围绕中灰 0.5 线性拉伸(uContrast=1 恒等)
    c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  }
  if(uDither > 0.0){                                       // 有序抖动：4x4 Bayer 矩阵按像素注入半阶量化噪声，打散渐变条带
    int ix = int(gl_FragCoord.x) & 3;
    int iy = int(gl_FragCoord.y) & 3;
    float bayer[16] = float[16](
      0.0, 8.0, 2.0,10.0,
      12.0,4.0,14.0,6.0,
      3.0,11.0,1.0, 9.0,
      15.0,7.0,13.0,5.0);
    float t = (bayer[iy*4 + ix] / 16.0) - 0.5;            // ∈ [-0.5, 0.5)
    c = clamp(c + uDither * t / 255.0, 0.0, 1.0);        // 以 1/255 为单位的抖动
  }
  if(uGrain == 1){                                          // 胶片噪点：叠加高频随机颗粒(在暗角之后, 最终合成)
    float n = (hash21(vUv * (uFrame + 1.0) * 60.0) - 0.5) * uGrainStr;
    c = clamp(c + vec3(n), 0.0, 1.0);
  }
  if(uScanline > 0.0){                                     // CRT 扫描线：按画面纵向周期压暗，模拟老式显像管
    float lines = 320.0;                                   // 固定扫描线密度(约 160 条暗线)
    float s = 0.5 + 0.5 * sin(vUv.y * lines * 3.141592653589793);
    c *= mix(1.0, s, uScanline);                          // strength=1 时扫描线最深(暗线处亮度*(1-str))
  }
  if(uInvert > 0.0){ c = mix(c, vec3(1.0) - c, uInvert); }   // 反相/负片：围绕中灰反转亮度与色彩(经典暗房负片效果)
  if(uBorder > 0.0){                                       // 画面边框：四周压黑形成相框效果(暗角式矩形边框)
    vec2 d = min(vUv, 1.0 - vUv);                          // 到最近边的距离(0..0.5)
    float edge = uBorder * 0.35;                           // 边框厚度(占半幅比例)
    float bx = smoothstep(edge, edge * 0.5, d.x);
    float by = smoothstep(edge, edge * 0.5, d.y);
    float b = clamp(bx + by, 0.0, 1.0);
    c = mix(c, vec3(0.0), b * uBorder);
  }
  if(uBright > 0.0){ c = clamp(c * (1.0 + uBright), 0.0, 1.0); }   // 亮度增益：整体提亮(暗部与亮部同比例放大并钳制)
  if(uDuotone > 0.0){                                     // 双色调(Duotone, uDuotone∈[0,1])：按亮度 l 在暗部色(uDuotoneShadow)↔高光色(uDuotoneHigh)间插值; 两色契约∈[0,1](取色器/反序列化均守卫), UI 端已加 NaN 守卫避免非法 hex 污染
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 dt = clamp(mix(uDuotoneShadow, uDuotoneHigh, l), 0.0, 1.0);
    c = mix(c, dt, uDuotone);
  }
  if(uVibrance > 0.0){                                     // 自然饱和度：低饱和像素提拉更多，高饱和几乎不变
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx - mn;
    float boost = 1.0 + uVibrance * (1.0 - sat);
    c = clamp(vec3(l) + (c - vec3(l)) * boost, 0.0, 1.0);
  }
  if(uMono > 0.0){                                         // 去色/灰度：按 Rec.709 亮度混入灰度
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(l), uMono);
  }
  if(uTint > 0.0){                                         // 色调染色：按暖色 tint 乘以
    vec3 tintCol = vec3(1.05, 0.85, 0.60);
    c = clamp(c * mix(vec3(1.0), tintCol, uTint), 0.0, 1.0);
  }
  if(uBalance > 0.0){                                       // 色彩平衡：b=2t-1，暖/冷双向
    float b = uBalance * 2.0 - 1.0;
    c.r = clamp(c.r + 0.15 * b, 0.0, 1.0);
    c.b = clamp(c.b - 0.15 * b, 0.0, 1.0);
  }
  if(uBleach > 0.0){                                        // 漂白旁路：向半去饱和亮度混合
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 bch = mix(c, vec3(l), 0.5);
    c = mix(c, bch, uBleach);
  }
  if(uFade > 0.0){                                          // 褪色：轻微去饱和 + 抬高黑位
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(l), 0.35 * uFade);
    c = mix(c, vec3(0.92, 0.90, 0.86), 0.30 * uFade);
  }
  if(uSplitTone > 0.0){                                     // 分离色调：阴影染冷(青)、高光染暖(橙)，按亮度插值
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 shadowTint = vec3(0.90, 0.95, 1.10);
    vec3 highTint   = vec3(1.10, 0.95, 0.85);
    vec3 tint = mix(shadowTint, highTint, clamp(l, 0.0, 1.0));
    c = clamp(mix(c, c * tint, uSplitTone), 0.0, 1.0);
  }
  if(uHighlights > 0.0){                                   // 高光压缩：仅对超过阈值的高亮区做肩式滚降
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float h = max(l - 0.55, 0.0) / 0.45;
    c = c * (1.0 - uHighlights * h * 0.5);
  }
  if(uGlow > 0.0){                                         // 柔光：仅对亮度>0.6 的高亮区按自身色相增强(伪 bloom)
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float g = max(l - 0.6, 0.0) / 0.4;
    c = c + uGlow * g * c;
  }
  if(uSolarize > 0.0){                                      // 色调分离：亮度>0.5 的部分按强度反相(mix 到 1-c)
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if(l > 0.5){ c = mix(c, vec3(1.0) - c, uSolarize); }
  }
  if(uExpose > 0.0){                                        // 曝光：按 2^t 倍率整体提亮(曝光补偿)
    c = c * pow(2.0, uExpose);
  }
  if(uThreshold > 0.0){                                     // 阈值二值化：luma<=t 转黑, 否则转白
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = vec3(step(uThreshold, l));
  }
  if(uCrossprocess > 0.0){                                  // 交叉冲印：阴影染冷(蓝升红降)、高光染暖(红绿升蓝降)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 cool = vec3(-0.12, -0.02, 0.14);
    vec3 warm = vec3(0.16, 0.08, -0.12);
    float m = smoothstep(0.0, 1.0, l);
    c = clamp(c + uCrossprocess * mix(cool, warm, m), 0.0, 1.0);
  }
  if(uFalsecolor > 0.0){                                   // 伪彩映射：亮度→ironbow 热成像色，按强度 mix 到原图
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, falseColor(l), uFalsecolor);
  }
  if(uGradientmap > 0.0){                                  // 渐变映射：亮度→日落渐变(深蓝→绯红→金黄)，按强度 mix 到原图
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, gradientMap(l), uGradientmap);
  }
  if(uPastel > 0.0){                                       // 粉彩：去饱和后向白提亮，营造柔和粉彩质感
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 desat = mix(c, vec3(l), 0.4);
    vec3 soft = mix(desat, vec3(1.0), 0.25);
    c = mix(c, soft, uPastel);
  }
  if(uInfrared > 0.0){                                     // 红外假彩：亮度→热成像伪彩(黑→紫→红→橙→黄→白)，按强度 mix 到原图
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, infraredMap(l), uInfrared);
  }
  if(uRadial > 0.0){                                       // 径向色相：色相随到画面中心的径向距离旋转
    float radius = distance(vUv, vec2(0.5));
    float deg = radius * 720.0 * uRadial;
    c = mix(c, hueShift(c, deg), uRadial);
  }
  if(uSwirl > 0.0){                                        // 漩涡色相：色相随半径渐进旋转（漩涡/扭曲感）
    float radius = distance(vUv, vec2(0.5));
    float deg = pow(radius, 1.5) * 1080.0 * uSwirl;
    c = mix(c, hueShift(c, deg), uSwirl);
  }
  if(uCyanotype > 0.0){                                    // 蓝晒：亮度映射 普鲁士蓝(暗)→青蓝(中)→纸白(亮)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 cyDark = vec3(0.04, 0.10, 0.28);
    vec3 cyMid  = vec3(0.13, 0.36, 0.62);
    vec3 cyLite = vec3(0.93, 0.96, 0.98);
    vec3 cy = (l < 0.5) ? mix(cyDark, cyMid, l / 0.5) : mix(cyMid, cyLite, (l - 0.5) / 0.5);
    c = mix(c, cy, uCyanotype);
  }
  if(uSelenium > 0.0){                                     // 硒调：阴影染紫褐、中间调轻染、高光保持中性(暗房硒盐调色)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 seTone = vec3(0.42, 0.30, 0.38);                  // 紫褐硒色
    float w = 1.0 - smoothstep(0.0, 0.75, l);              // 越暗染越重，高光基本不染
    vec3 se = mix(vec3(l), seTone * (0.35 + 0.65 * l / 0.4), w);
    se = clamp(se, 0.0, 1.0);
    c = mix(c, se, uSelenium);
  }
  if(uMoonlight > 0.0){                                    // 月光：冷银蓝单色 + 压暗高光(月夜曝光)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    float ml = pow(l, 1.35);                               // 压暗中高光, 保留暗部层次
    vec3 mo = vec3(ml * 0.62, ml * 0.74, ml * 0.95);       // 银蓝色调
    mo = clamp(mo + vec3(0.02, 0.03, 0.06), 0.0, 1.0);     // 微弱蓝色环境底光
    c = mix(c, mo, uMoonlight);
  }
  if(uVerdigris > 0.0){                                    // 铜绿：暗部深铜褐 → 中部锈绿 → 亮部青绿
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 vdDark = vec3(0.16, 0.12, 0.07);                  // 深铜褐
    vec3 vdMid  = vec3(0.22, 0.48, 0.38);                  // 锈绿
    vec3 vdLite = vec3(0.55, 0.85, 0.75);                  // 青绿锈
    vec3 vd = (l < 0.5) ? mix(vdDark, vdMid, l / 0.5) : mix(vdMid, vdLite, (l - 0.5) / 0.5);
    c = mix(c, vd, uVerdigris);
  }
  if(uRosegold > 0.0){                                     // 玫瑰金：阴影暖褐 → 中部玫瑰粉 → 高光粉金
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 rgDark = vec3(0.28, 0.16, 0.14);                  // 暖褐
    vec3 rgMid  = vec3(0.72, 0.46, 0.42);                  // 玫瑰粉
    vec3 rgLite = vec3(0.98, 0.84, 0.76);                  // 粉金高光
    vec3 rg = (l < 0.5) ? mix(rgDark, rgMid, l / 0.5) : mix(rgMid, rgLite, (l - 0.5) / 0.5);
    c = mix(c, rg, uRosegold);
  }
  if(uAurora > 0.0){                                       // 极光：亮度驱动 绿→青→紫 三段渐变帷幕
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 auDark = vec3(0.02, 0.08, 0.10);                  // 夜空暗底
    vec3 auGrn  = vec3(0.10, 0.85, 0.45);                  // 极光绿
    vec3 auVio  = vec3(0.62, 0.40, 0.95);                  // 极光紫
    vec3 au = (l < 0.55) ? mix(auDark, auGrn, l / 0.55) : mix(auGrn, auVio, (l - 0.55) / 0.45);
    c = mix(c, au, uAurora);
  }
  if(uAmber > 0.0){                                        // 琥珀：深棕(暗) → 琥珀橙(中) → 蜜黄(亮)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    l = clamp(l, 0.0, 1.0);
    vec3 amDark = vec3(0.14, 0.07, 0.02);                  // 深棕
    vec3 amMid  = vec3(0.78, 0.48, 0.12);                  // 琥珀橙
    vec3 amLite = vec3(1.00, 0.88, 0.55);                  // 蜜黄
    vec3 am = (l < 0.5) ? mix(amDark, amMid, l / 0.5) : mix(amMid, amLite, (l - 0.5) / 0.5);
    c = mix(c, am, uAmber);
  }
  if(uNight > 0.0){                                        // 夜视绿：绿单色 + 轻微提亮/对比
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 nv = vec3(l * 0.15, l, l * 0.25);
    nv = clamp(nv * (1.0 + 0.5 * uNight) + 0.02, 0.0, 1.0);
    c = mix(c, nv, uNight);
  }
  if(uEmboss > 0.0){                                       // 浮雕：用 dFdx/dFdy 导数做方向性浮雕
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float gx = dFdx(l);
    float gy = dFdy(l);
    float e = (gx + gy) * uEmboss * 4.0;
    c = mix(c, clamp(vec3(0.5) + vec3(e), 0.0, 1.0), uEmboss);
  }
  if(uEdge > 0.0){                                         // 边缘检测：用 dFdx/dFdy 计算亮度梯度幅值做边缘
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float gx = dFdx(l);
    float gy = dFdy(l);
    float mag = sqrt(gx * gx + gy * gy);
    c = mix(c, vec3(mag * uEdge * 8.0), uEdge);
  }
  if(uPixelate > 0.0){                                     // 像素化(Pixelate, uPixelate/uPixelSize∈[0,1])：把 UV 量子化到方块重采样得马赛克；uPixelate 控方块数、uPixelSize 控粗细(coarse), 二者均已钳制到 [0,1], 越界会让 cells 复用越界导致花屏
    float coarse = mix(1.0, 3.0, clamp(uPixelSize, 0.0, 1.0));  // 1=原粒度, 3=更粗
    float cells = max(mix(160.0, 8.0, uPixelate) / coarse, 2.0);
    vec2 cell = (floor(vUv * cells) + 0.5) / cells;
    vec3 src = sampleHDR(cell);
    vec3 pc = tonemap(src * uExposure, uTone);
    c = mix(c, pc, uPixelate);
  }
  if(uRgbshift > 0.0){                                     // RGB 偏移/色散：R/B 通道水平错位
    float amt = uRgbshift * 0.05;
    vec3 r = sampleHDR(vec2(vUv.x - amt, vUv.y));
    vec3 b = sampleHDR(vec2(vUv.x + amt, vUv.y));
    vec3 shifted = vec3(r.r, c.g, b.b);
    c = mix(c, shifted, uRgbshift);
  }
  if(uHalftone > 0.0){                                     // 半调网点：按亮度做旋转网格点阵(经典印刷感, 亮=纸白 暗=墨点)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float cells = mix(40.0, 120.0, uHalftone);            // 网点更密 => 渐变更细腻
    vec2 g = fract(vUv * cells) - 0.5;                     // 单元中心为 0, 角点 ~0.707
    float ang = 0.5236;                                    // 30° 旋转网格(经典半调角)
    vec2 rg = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * g;
    float d = length(rg);                                  // 到单元中心距离
    float radius = (1.0 - l) * 0.7071;                     // 亮部 radius≈0(无墨点, 全纸白), 暗部 radius 大(墨点大)
    float ink = smoothstep(radius - 0.06, radius + 0.06, d); // d>radius => 纸白(1), d<radius => 墨黑(0)
    vec3 ht = vec3(ink);
    c = mix(c, ht, uHalftone);
  }
  if(uTechni > 0.0){                                       // 三色染印：去饱和后按亮度在青绿/红橙/暖黄三段映射
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 sh = vec3(0.04, 0.22, 0.26);                      // 阴影：青绿
    vec3 mid = vec3(0.85, 0.22, 0.12);                     // 中间：红橙
    vec3 hi = vec3(1.0, 0.86, 0.55);                       // 高光：暖黄
    vec3 tc = (l < 0.5) ? mix(sh, mid, l/0.5) : mix(mid, hi, (l-0.5)/0.5);
    c = mix(c, tc, uTechni);
  }
  if(uVhs > 0.0){                                          // VHS 录像带：横向色偏 + 跟踪抖动 + 磁带噪点
    float band = floor(vUv.y * 24.0);                      // 横向条纹带(模拟磁迹)
    float n = hash21(vec2(band, uFrame * 0.5));            // 每带随机抖动
    float wob = (n - 0.5) * 0.02 * uVhs;                   // 跟踪误差：横向整带偏移
    float off = (0.004 + 0.01 * n) * uVhs;                 // 色散偏移量
    vec3 r = sampleHDR(vec2(vUv.x - off + wob, vUv.y));
    vec3 b = sampleHDR(vec2(vUv.x + off + wob, vUv.y));
    vec3 v = vec3(r.r, c.g, b.b);
    float lines = 0.5 + 0.5 * sin(vUv.y * 240.0 + n * 6.2831); // 纵向亮度带(磁带不均)
    v *= mix(1.0, 0.85 + 0.15 * lines, uVhs);
    float g = (hash21(vUv * (uFrame + 2.0) * 30.0) - 0.5) * 0.08 * uVhs; // 磁带颗粒噪点
    v = clamp(v + vec3(g), 0.0, 1.0);
    c = mix(c, v, uVhs);
  }
  if(uColorkey > 0.0){                                     // 色度键控/绿幕抠像：靠近关键色(绿)的像素被压暗抠除
    vec3 key = vec3(0.10, 0.80, 0.20);                     // 默认绿幕关键色
    float d = distance(c, key);
    float thr = mix(0.25, 0.60, uColorkey);                // 强度越大抠除范围越宽
    float k = smoothstep(thr, thr + 0.15, d);              // d<thr => 抠除(0), d>thr+0.15 => 保留(1)
    c = c * k;                                             // 抠除区域压黑(合成留白)
  }
  if(uAnaglyph > 0.0){                                    // 红蓝立体(Anaglyph)：左右眼由水平错位采样模拟, 红=左 青=右
    float s = uAnaglyph * 0.02;                           // 视差位移量
    vec3 L = sampleHDR(vUv + vec2(s, 0.0)).rgb;           // 左眼(略右移) → 红通道
    vec3 R = sampleHDR(vUv - vec2(s, 0.0)).rgb;           // 右眼(略左移) → 青通道(绿+蓝)
    vec3 an = vec3(L.r, R.g, R.b);                        // 经典红/青立体
    c = mix(c, an, uAnaglyph);
  }
  if(uOil > 0.0){                                            // 油画：邻域分箱取众数亮度桶的平均色, 模拟笔触块化
    vec2 rad = vec2(0.0035) * (0.5 + uOil);                  // 笔触尺度随强度增大
    vec3 sums[4]; float cnts[4];
    for(int i=0;i<4;i++){ sums[i]=vec3(0.0); cnts[i]=0.0; }
    for(int y=-2;y<=2;y++){
      for(int x=-2;x<=2;x++){
        vec2 o = vec2(float(x), float(y)) * rad;
        vec3 col = sampleHDR(vUv + o);
        float l = dot(col, vec3(0.299,0.587,0.114));
        int b = int(clamp(floor(l*4.0),0.0,3.0));
        sums[b]+=col; cnts[b]+=1.0;
      }
    }
    int best=0; float bc=-1.0;
    for(int i=0;i<4;i++){ if(cnts[i]>bc){ bc=cnts[i]; best=i; } }
    vec3 oil = sums[best]/max(cnts[best],1.0);
    c = mix(c, oil, uOil);
  }
  if(uLomo > 0.0){                                            // Lomo：暗角 + 阴影青蓝/高光暖色偏 + 提饱和
    vec2 q = vUv - 0.5;
    float vig = smoothstep(0.85, 0.15, length(q) * 1.3);      // 强暗角
    c *= mix(1.0, vig, uLomo);
    float l = dot(c, vec3(0.299,0.587,0.114));
    vec3 shadowTint = vec3(0.90, 0.96, 1.06);                 // 阴影偏青蓝
    vec3 highTint   = vec3(1.06, 0.98, 0.88);                 // 高光偏暖
    c *= mix(shadowTint, highTint, l);
    float sat = 1.0 + 0.45 * uLomo;
    float g = dot(c, vec3(0.299,0.587,0.114));
    c = mix(vec3(g), c, sat);
    c = clamp(c, 0.0, 1.0);
  }
  if(uLeak > 0.0){                                            // 漏光：左上角彩色辉光
    vec2 d = vUv - vec2(0.05, 0.95);
    float r = length(d);
    float glow = smoothstep(0.7, 0.0, r) * uLeak;
    vec3 leakCol = mix(vec3(1.0,0.4,0.7), vec3(0.4,0.7,1.0), vUv.x);
    c = mix(c, c + leakCol * glow, uLeak);
  }
  if(uWave > 0.0){                                            // 波形畸变：水平正弦行偏移重采样
    vec2 wuv = vUv + vec2(sin(vUv.y * 38.0 + float(uFrame) * 0.05) * 0.01 * uWave, 0.0);
    c = mix(c, sampleHDR(wuv), uWave);
  }
  if(uCnoise > 0.0){                                          // 彩色噪点
    float n1 = hash21(vUv * (float(uFrame) + 3.0) * 13.0);
    float n2 = hash21(vUv * (float(uFrame) + 7.0) * 17.0);
    float n3 = hash21(vUv * (float(uFrame) + 11.0) * 19.0);
    c = mix(c, c + (vec3(n1, n2, n3) - 0.5) * uCnoise, uCnoise);
  }
  if(uKaleido > 0.0){                                         // 万花筒：楔形镜像重采样
    vec2 kp = vUv - 0.5;
    float ka = atan(kp.y, kp.x);
    float krad = length(kp);
    float kseg = 3.14159265 / 4.0;
    ka = abs(mod(ka, 2.0 * kseg) - kseg);
    vec2 kuv = vec2(cos(ka), sin(ka)) * krad + 0.5;
    c = mix(c, sampleHDR(kuv), uKaleido);
  }
  if(uRipple > 0.0){                                          // 水波纹：径向正弦位移重采样
    vec2 rp = vUv - 0.5;
    float rrad = length(rp);
    float disp = sin(rrad * 40.0 - float(uFrame) * 0.1) * 0.012 * uRipple;
    vec2 ruv = vUv + normalize(rp + 1e-5) * disp;
    c = mix(c, sampleHDR(ruv), uRipple);
  }
  if(uHuequant > 0.0){                                        // 色相分层
    c = mix(c, hueQuant(c, mix(2.0, 12.0, uHuequant)), uHuequant);
  }
  if(uLift > 0.0){                                            // 暗部提升
    float l = dot(c, vec3(0.299,0.587,0.114));
    float f = (1.0 - smoothstep(0.0, 0.5, l)) * 0.4 * uLift;
    c = c + f;
  }
  if(uHsat > 0.0){                                            // 高光饱和
    float l = dot(c, vec3(0.299,0.587,0.114));
    float boost = 1.0 + uHsat * smoothstep(0.5, 1.0, l);
    c = mix(vec3(l), c, boost);
  }
  if(uLetterbox > 0.0){                                       // 电影黑边：上下各按高度比例压黑(在最终合成阶段, 保证纯黑)
    float hb = clamp(uLetterbox, 0.0, 0.5);
    if(vUv.y < hb || vUv.y > 1.0 - hb) c = vec3(0.0);
  }
  if(uWatercolor > 0.0){                                     // 水彩(Watercolor, uWatercolor∈[0,1])：纸纹噪声微扰 + 湿边聚色, 营造手绘通透感; 契约: 入参已钳制到 [0,1], 否则 mix 外推会污染画面
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float paper = (hash21(floor(gl_FragCoord.xy * 0.7) + 13.0) - 0.5) * 0.06;  // 低频纸纹纤维
    vec3 wc = clamp(c + vec3(paper), 0.0, 1.0);
    float edge = length(vec2(dFdx(l), dFdy(l)));            // 亮度梯度 -> 色块边界
    wc *= 1.0 - clamp(edge * 5.0, 0.0, 0.35) * uWatercolor; // 湿边：边缘聚色压暗
    float lw = dot(wc, vec3(0.299, 0.587, 0.114));
    wc = mix(wc, vec3(lw), 0.2 * uWatercolor);              // 轻微去饱和, 更通透
    c = mix(c, wc, uWatercolor);
  }
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(c,1.0);
  }`;

// ---------- 编译工具 ----------
function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const ptProg = program(VERT, PT_FRAG);
const showProg = program(VERT, SHOW_FRAG);

// 全屏 quad
const quad = gl.createVertexArray();
gl.bindVertexArray(quad);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(ptProg, 'aPos');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

// ---------- 累积缓冲 ping-pong ----------
let texA, texB, fboA, fboB, RW, RH;
function makeTex(w,h){
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function makeFbo(tex){
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return f;
}
function allocBuffers(){
  if(texA) { gl.deleteTexture(texA); gl.deleteTexture(texB); gl.deleteFramebuffer(fboA); gl.deleteFramebuffer(fboB); }
  RW = Math.max(2, Math.floor(canvas.clientWidth * resScale));
  RH = Math.max(2, Math.floor(canvas.clientHeight * resScale));
  canvas.width = RW; canvas.height = RH;
  texA = makeTex(RW,RH); fboA = makeFbo(texA);
  texB = makeTex(RW,RH); fboB = makeFbo(texB);
  clearAccum();
}
function clearAccum(){
  for(const f of [fboA,fboB]){
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  frame = 0;
}

// ====================================================================
// 网格生成 + BVH 构建（JS 端）
// ====================================================================
function makeTorus(R, r, segU, segV){
  const tris = [];
  const pos = (i,j)=>{
    const u = 2*Math.PI*i/segU, v = 2*Math.PI*j/segV;
    const cu=Math.cos(u), su=Math.sin(u), cv=Math.cos(v), sv=Math.sin(v);
    return [
      (R + r*cv)*cu,
      (R + r*cv)*su,
      r*sv
    ];
  };
  const normal = (j)=>{
    const v = 2*Math.PI*j/segV, cv=Math.cos(v), sv=Math.sin(v);
    return [cv, cv, sv]; // 近似（稍后在面级归一化方向）
  };
  for(let i=0;i<segU;i++){
    for(let j=0;j<segV;j++){
      const a = pos(i,j),   b = pos(i+1,j);
      const c = pos(i+1,j+1), d = pos(i,j+1);
      const na = normal(j), nb = normal(j), nc = normal(j+1), nd = normal(j+1);
      // 两个三角形
      tris.push({v0:a,v1:b,v2:c, n:faceNormal(a,b,c), albedo:[0.95,0.55,0.30], mat:0});
      tris.push({v0:a,v1:c,v2:d, n:faceNormal(a,c,d), albedo:[0.95,0.55,0.30], mat:0});
    }
  }
  return tris;
}
function faceNormal(a,b,c){
  const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
  const e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const n=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
  const l=Math.hypot(n[0],n[1],n[2])||1;
  return [n[0]/l,n[1]/l,n[2]/l];
}
const LEAF = 8;
const SAH_BINS = 32;
function buildBVH(tris){
  const N = tris.length;
  const idx = new Array(N); for(let i=0;i<N;i++) idx[i]=i;
  // 预计算每个三角形的包围盒与质心（按原始下标）
  const tAABB = new Array(N), tCen = new Array(N);
  for(let i=0;i<N;i++){
    const t=tris[i];
    tAABB[i] = {
      mn:[Math.min(t.v0[0],t.v1[0],t.v2[0]),Math.min(t.v0[1],t.v1[1],t.v2[1]),Math.min(t.v0[2],t.v1[2],t.v2[2])],
      mx:[Math.max(t.v0[0],t.v1[0],t.v2[0]),Math.max(t.v0[1],t.v1[1],t.v2[1]),Math.max(t.v0[2],t.v1[2],t.v2[2])]
    };
    tCen[i] = [ (t.v0[0]+t.v1[0]+t.v2[0])/3, (t.v0[1]+t.v1[1]+t.v2[1])/3, (t.v0[2]+t.v1[2]+t.v2[2])/3 ];
  }
  const INF = 1e30;
  const SA = (mn,mx)=>{ const dx=Math.max(0,mx[0]-mn[0]),dy=Math.max(0,mx[1]-mn[1]),dz=Math.max(0,mx[2]-mn[2]); return 2*(dx*dy+dy*dz+dz*dx); };
  function bounds(s,e){
    const mn=[INF,INF,INF], mx=[-INF,-INF,-INF], c0=[INF,INF,INF], c1=[-INF,-INF,-INF];
    for(let i=s;i<e;i++){ const k=idx[i], b=tAABB[k], c=tCen[k];
      for(let d=0;d<3;d++){ if(b.mn[d]<mn[d])mn[d]=b.mn[d]; if(b.mx[d]>mx[d])mx[d]=b.mx[d]; if(c[d]<c0[d])c0[d]=c[d]; if(c[d]>c1[d])c1[d]=c[d]; } }
    return {mn,mx,c0,c1};
  }
  function partition(s,e,axis,pos){
    let i=s, j=e-1;
    while(i<=j){ const c=tCen[idx[i]][axis];
      if(c<=pos){ i++; } else { const tmp=idx[i]; idx[i]=idx[j]; idx[j]=tmp; j--; } }
    return i;
  }
  const nodes=[];
  function build(s,e){
    const ni=nodes.length;
    const {mn,mx,c0,c1}=bounds(s,e);
    nodes.push({mn,mx,left:-1,start:-1,count:-1});
    const count=e-s;
    if(count<=LEAF){ nodes[ni].start=s; nodes[ni].count=count; return ni; }
    // —— SAH 分箱：对每条轴找最小代价分割平面 ——
    let bestCost=INF, bestAxis=-1, bestPos=0;
    const BB=SAH_BINS;
    for(let axis=0;axis<3;axis++){
      const lo=c0[axis], hi=c1[axis], span=hi-lo;
      if(span<=1e-9) continue;                       // 该轴质心无跨度，跳过
      const binCount=new Array(BB).fill(0);
      const binMin=[], binMax=[];
      for(let b=0;b<BB;b++){ binMin.push([INF,INF,INF]); binMax.push([-INF,-INF,-INF]); }
      for(let i=s;i<e;i++){ const k=idx[i];
        const b=Math.min(BB-1, Math.max(0, Math.floor((tCen[k][axis]-lo)/span*BB)));
        binCount[b]++; const bb=tAABB[k];
        for(let d=0;d<3;d++){ if(bb.mn[d]<binMin[b][d])binMin[b][d]=bb.mn[d]; if(bb.mx[d]>binMax[b][d])binMax[b][d]=bb.mx[d]; } }
      // 前向累积左侧包围盒、后向累积右侧包围盒
      const Lc=[], Lmin=[], Lmax=[];
      let lc=0; const lmn=[INF,INF,INF], lmx=[-INF,-INF,-INF];
      for(let b=0;b<BB;b++){ lc+=binCount[b];
        if(binCount[b]>0){ for(let d=0;d<3;d++){ if(binMin[b][d]<lmn[d])lmn[d]=binMin[b][d]; if(binMax[b][d]>lmx[d])lmx[d]=binMax[b][d]; } }
        Lc.push(lc); Lmin.push(lmn.slice()); Lmax.push(lmx.slice()); }
      const Rc=new Array(BB), Rmin=[], Rmax=[];
      let rc=0; const rmn=[INF,INF,INF], rmx=[-INF,-INF,-INF];
      for(let b=BB-1;b>=0;b--){ rc+=binCount[b];
        if(binCount[b]>0){ for(let d=0;d<3;d++){ if(binMin[b][d]<rmn[d])rmn[d]=binMin[b][d]; if(binMax[b][d]>rmx[d])rmx[d]=binMax[b][d]; } }
        Rc[b]=rc; Rmin[b]=rmn.slice(); Rmax[b]=rmx.slice(); }
      for(let b=0;b<BB-1;b++){
        const lc2=Lc[b], rc2=Rc[b+1];
        if(lc2===0||rc2===0) continue;
        const cost = lc2*SA(Lmin[b],Lmax[b]) + rc2*SA(Rmin[b+1],Rmax[b+1]);
        if(cost<bestCost){ bestCost=cost; bestAxis=axis; bestPos=lo+(b+1)/BB*span; }
      }
    }
    // 退化保护：SAH 无可行分割时回退质心范围最大轴的中点
    if(bestAxis<0){ let axis=0,ext=c1[0]-c0[0];
      if(c1[1]-c0[1]>ext){axis=1;ext=c1[1]-c0[1];} if(c1[2]-c0[2]>ext){axis=2;ext=c1[2]-c0[2];}
      bestAxis=axis; bestPos=(c0[axis]+c1[axis])*0.5; }
    let split=partition(s,e,bestAxis,bestPos);
    if(split<=s || split>=e) split=(s+e)>>1;          // 防止出现空侧
    const leftChild=build(s,split); nodes[ni].left=leftChild; build(split,e);  // 右孩子 = left+1（GLSL 约定）
    return ni;
  }
  build(0,N);
  const ordered = idx.map(k=>tris[k]);
  return { nodes, ordered };
}
function packAndUpload(tris){
  // 三角形纹理：每三角形 5 个 RGBA texel
  const TW=1024;
  const triTexels = tris.length*5;
  const th = Math.max(1, Math.ceil(triTexels/TW));
  const triData = new Float32Array(TW*th*4);
  for(let i=0;i<tris.length;i++){
    const t=tris[i], b=i*5;
    const put=(o,x,y,z,w)=>{ triData[(b+o)*4+0]=x; triData[(b+o)*4+1]=y; triData[(b+o)*4+2]=z; triData[(b+o)*4+3]=w; };
    put(0,t.v0[0],t.v0[1],t.v0[2],t.mat);
    put(1,t.v1[0],t.v1[1],t.v1[2],0);
    put(2,t.v2[0],t.v2[1],t.v2[2],0);
    put(3,t.n[0],t.n[1],t.n[2],0);
    put(4,t.albedo[0],t.albedo[1],t.albedo[2],0);
  }
  const triTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, triTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,TW,th,0,gl.RGBA,gl.FLOAT,triData);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);

  // BVH 节点纹理：每节点 2 个 RGBA texel
  const NW=1024;
  const nodeTexels = bvh.nodes.length*2;
  const nh = Math.max(1, Math.ceil(nodeTexels/NW));
  const nodeData = new Float32Array(NW*nh*4);
  for(let i=0;i<bvh.nodes.length;i++){
    const nd=bvh.nodes[i], b=i*2;
    nodeData[(b+0)*4+0]=nd.mn[0]; nodeData[(b+0)*4+1]=nd.mn[1]; nodeData[(b+0)*4+2]=nd.mn[2]; nodeData[(b+0)*4+3]=nd.left;
    nodeData[(b+1)*4+0]=nd.mx[0]; nodeData[(b+1)*4+1]=nd.mx[1]; nodeData[(b+1)*4+2]=nd.mx[2]; nodeData[(b+1)*4+3]=nd.count;
  }
  const bvhTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bvhTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,NW,nh,0,gl.RGBA,gl.FLOAT,nodeData);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return { triTex, bvhTex, triCount: tris.length };
}

// ---------- 模型导入：OBJ / glTF（最简解析 → 三角形数组 → 重建 BVH）----------
// OBJ：v/vn/f，面用三角扇化；法线缺失时用面法线；材质统一近似为漫反射。
function parseOBJ(text){
  const verts = [], norms = [], tris = [];
  const lines = text.split(/\r?\n/);
  for(const line of lines){
    const t = line.trim();
    if(t === '' || t[0] === '#') continue;
    const p = t.split(/\s+/);
    if(p[0] === 'v')      verts.push([+p[1], +p[2], +p[3]]);
    else if(p[0] === 'vn') norms.push([+p[1], +p[2], +p[3]]);
    else if(p[0] === 'f'){
      const idx = [];
      for(let i=1;i<p.length;i++){ const f = p[i].split('/'); idx.push(parseInt(f[0], 10) - 1); }
      if(idx.length < 3) continue;
      const push = (a,b,c)=> tris.push({ v0:a, v1:b, v2:c, n: faceNormal(a,b,c), albedo:[0.82,0.6,0.38], mat:0 });
      push(verts[idx[0]], verts[idx[1]], verts[idx[2]]);            // 三角扇：首顶点 + 每对后续顶点
      for(let i=3;i<idx.length;i++) push(verts[idx[0]], verts[idx[i-1]], verts[idx[i]]);
    }
  }
  return tris;
}
// glTF 2.0（最简）：单 buffer（data: base64 内联）、POSITION 存取器、可选索引；
// 仅支持 FLOAT(VEC3) 顶点与 UNSIGNED_INT/SHORT/BYTE 索引；材质近似为漫反射。
function parseGLTF(json){
  const buffers = (json.buffers || []).map(b=>{
    if(typeof b.uri === 'string' && b.uri.startsWith('data:')){
      const b64 = b.uri.split(',')[1];
      return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }
    return null;
  });
  const f32 = (acc)=>{
    const v = json.bufferViews[acc.bufferView];
    return new Float32Array(buffers[v.buffer].buffer, (v.byteOffset||0) + (acc.byteOffset||0), acc.count*3);
  };
  const indicesOf = (acc)=>{
    const v = json.bufferViews[acc.bufferView];
    const base = (v.byteOffset||0) + (acc.byteOffset||0);
    const buf = buffers[v.buffer];
    if(acc.componentType === 5125) return new Uint32Array(buf.buffer, base, acc.count);
    if(acc.componentType === 5123) return new Uint16Array(buf.buffer, base, acc.count);
    if(acc.componentType === 5121) return new Uint8Array(buf.buffer, base, acc.count);
    return new Uint32Array(buf.buffer, base, acc.count);
  };
  const tris = [];
  for(const mesh of (json.meshes || [])){
    for(const prim of (mesh.primitives || [])){
      const pos = f32(json.accessors[prim.attributes.POSITION]);
      const v = i => [pos[i*3], pos[i*3+1], pos[i*3+2]];
      if(prim.indices != null){
        const id = indicesOf(json.accessors[prim.indices]);
        for(let k=0;k<id.length;k+=3){
          const a=v(id[k]), b=v(id[k+1]), c=v(id[k+2]);
          tris.push({ v0:a, v1:b, v2:c, n: faceNormal(a,b,c), albedo:[0.82,0.6,0.38], mat:0 });
        }
      } else {
        for(let k=0;k<pos.length/3;k+=3){
          const a=v(k), b=v(k+1), c=v(k+2);
          tris.push({ v0:a, v1:b, v2:c, n: faceNormal(a,b,c), albedo:[0.82,0.6,0.38], mat:0 });
        }
      }
    }
  }
  return tris;
}

// 生成网格 + BVH 并上传（可重复调用以替换当前模型）
let bvh = null, meshTex = null;
const HAS_MESH = 1;
function loadModel(tris){
  bvh = buildBVH(tris);
  if(meshTex){ gl.deleteTexture(meshTex.triTex); gl.deleteTexture(meshTex.bvhTex); }
  meshTex = packAndUpload(bvh.ordered);
  console.log('[Lumen] 模型三角形数 =', meshTex.triCount, ' BVH 节点数 =', bvh.nodes.length);
}
const torus = makeTorus(2.2, 0.9, 56, 28);   // 约 3136 个三角形
loadModel(torus);

// ---------- 相机 (轨道) ----------
let theta = 0.6, phi = 1.15, radius = 9.0, target = [0,0,0];
function camBasis(){
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const pos = [
    target[0] + radius*sp*Math.sin(theta),
    target[1] + radius*cp,
    target[2] + radius*sp*Math.cos(theta)
  ];
  const fwd = norm(sub(target, pos));
  const right = norm(cross(fwd, [0,1,0]));
  const up = cross(right, fwd);
  return { pos, fwd, right, up };
}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(a)=>{const l=Math.hypot(...a)||1;return [a[0]/l,a[1]/l,a[2]/l];};

// ---------- 交互 ----------
let dragging=false, lx=0, ly=0;
canvas.onmousedown = e=>{ dragging=true; lx=e.clientX; ly=e.clientY; };
window.onmouseup = ()=> dragging=false;
window.onmousemove = e=>{
  if(!dragging) return;
  theta -= (e.clientX-lx)*0.005; phi -= (e.clientY-ly)*0.005;
  phi = Math.max(0.15, Math.min(3.0, phi));
  lx=e.clientX; ly=e.clientY; clearAccum();
};
canvas.onwheel = e=>{ e.preventDefault(); radius *= (e.deltaY>0?1.08:0.93); radius=Math.max(3,Math.min(40,radius)); clearAccum(); };

// ---------- 控件 ----------
let sceneId=0, maxBounces=6, resScale=1.0, paused=false, envInt=1.0, exposure=1.0, focusDist=9.0, aperture=0.0, sunAz=35.0, sunEl=40.0, sunInt=1.0, autoRotate=false, rotAccum=0, maxSamples=2000, toneMode=0, autoExp=false, fogDensity=0.0, rrOn=false, denoiseOn=false, denIters=3, neeOn=true, bloomOn=false, bloomStr=0.6, bloomThr=1.0, vignetteOn=false, vigStr=0.5, chromaOn=false, chromaStr=0.5, grainOn=false, grainStr=0.08, gamma=2.2, rough=0.0, jitter=1.0, fogColor=[0.8,0.85,0.9], fov=50, bgTop=[0.20,0.36,0.66], bgBottom=[0.62,0.70,0.80], debugMode=0, clampRad=0, satStr=1, contrast=1, sharpen=0, dither=0, temp=0, hue=0, sepia=0, posterize=0, letterbox=0, scanline=0, invert=0, border=0, bright=0, duotone=0, vibrance=0, mono=0, tint=0, balance=0, bleach=0, fade=0, splittone=0, highlights=0, glow=0, solarize=0, expose=0, threshold=0, crossprocess=0, falsecolor=0, gradientmap=0, pastel=0, infrared=0, radial=0, swirl=0, night=0, emboss=0, edge=0, pixelate=0, rgbshift=0, halftone=0, techni=0, vhs=0, colorkey=0, anaglyph=0, lomo=0, oil=0; leak=0, wave=0, cnoise=0, kaleido=0, ripple=0, huequant=0, lift=0, hsat=0, fisheye=0, pointOn=0, pointPos=[3,4,-2], pointColor=[1,0.9,0.8], pointInt=8, glitch=0, cyanotype=0, selenium=0, moonlight=0, verdigris=0, rosegold=0, aurora=0, amber=0, watercolor=0, pixelSize=0, hueShift=0, duotoneShadow=[0.05,0.0,0.1], duotoneHigh=[1.0,0.9,0.7], chromaAmt=0.5;
// ---------- 场景预设（相机 + 渲染参数）JSON 导入/导出 ----------
// 纯函数：不依赖 THREE，便于 Node 测试与复用。
function serializeScene(s){
  return {
    v: 1,
    sceneId: s.sceneId, theta: s.theta, phi: s.phi, radius: s.radius,
    target: Array.isArray(s.target) ? [s.target[0], s.target[1], s.target[2]] : [0,0,0],
    maxBounces: s.maxBounces, resScale: s.resScale, exposure: s.exposure,
    focusDist: s.focusDist, aperture: s.aperture, maxSamples: s.maxSamples,
    sunAz: s.sunAz, sunEl: s.sunEl, sunInt: s.sunInt, rough: s.rough, jitter: s.jitter, fogColor: s.fogColor, fov: s.fov, bgTop: s.bgTop, bgBottom: s.bgBottom, debugMode: s.debugMode,
    toneMode: s.toneMode, autoExp: s.autoExp, fogDensity: s.fogDensity, rrOn: s.rrOn,
    denoiseOn: s.denoiseOn, denIters: s.denIters, neeOn: s.neeOn, envInt: s.envInt,
    bloomOn: s.bloomOn, bloomStr: s.bloomStr, bloomThr: s.bloomThr, vignetteOn: s.vignetteOn, vigStr: s.vigStr,
    chromaOn: s.chromaOn, chromaStr: s.chromaStr,
    grainOn: s.grainOn, grainStr: s.grainStr,
    gamma: s.gamma, clampRad: s.clampRad, satStr: s.satStr, contrast: s.contrast, sharpen: s.sharpen, dither: s.dither, temp: s.temp, hue: s.hue, sepia: s.sepia, posterize: s.posterize, letterbox: s.letterbox, scanline: s.scanline, invert: s.invert, border: s.border, bright: s.bright, duotone: s.duotone,     vibrance: s.vibrance, mono: s.mono, tint: s.tint, balance: s.balance, bleach: s.bleach, fade: s.fade, splittone: s.splittone, highlights: s.highlights, glow: s.glow, solarize: s.solarize, expose: s.expose, threshold: s.threshold, crossprocess: s.crossprocess, falsecolor: s.falsecolor, gradientmap: s.gradientmap, pastel: s.pastel, infrared: s.infrared, radial: s.radial, swirl: s.swirl, night: s.night, emboss: s.emboss, edge: s.edge, pixelate: s.pixelate, rgbshift: s.rgbshift, halftone: s.halftone, techni: s.techni, vhs: s.vhs, colorkey: s.colorkey, anaglyph: s.anaglyph, oil: s.oil, lomo: s.lomo, leak: s.leak, wave: s.wave, cnoise: s.cnoise, kaleido: s.kaleido, ripple: s.ripple, huequant: s.huequant, lift: s.lift, hsat: s.hsat, fisheye: s.fisheye, pointOn: s.pointOn, pointPos: s.pointPos, pointColor: s.pointColor, pointInt: s.pointInt, glitch: s.glitch, cyanotype: s.cyanotype, selenium: s.selenium, moonlight: s.moonlight, verdigris: s.verdigris, rosegold: s.rosegold, aurora: s.aurora, amber: s.amber, watercolor: s.watercolor, pixelSize: s.pixelSize, hueShift: s.hueShift, duotoneShadow: s.duotoneShadow, duotoneHigh: s.duotoneHigh, chromaAmt: s.chromaAmt
  };
}
function deserializeScene(d){
  d = d || {};
  const num = (k, def) => (typeof d[k] === 'number' && isFinite(d[k])) ? d[k] : def;
  const bool = (k, def) => (typeof d[k] === 'boolean') ? d[k] : def;
  const t = (Array.isArray(d.target) && d.target.length >= 3) ? [d.target[0], d.target[1], d.target[2]] : [0,0,0];
  // 颜色数组防御：长度须为 3 且全为有限数, 否则回退默认(损坏 JSON/NaN 不再污染渲染)
  const fin3 = (a, def) => (Array.isArray(a) && a.length===3 && a.every(v=>typeof v==='number' && isFinite(v))) ? a.map(Number) : def;
  return {
    sceneId: num('sceneId', 0), theta: num('theta', 0.6), phi: num('phi', 1.15), radius: num('radius', 9),
    target: t, maxBounces: num('maxBounces', 6), resScale: num('resScale', 1), exposure: Math.max(0, num('exposure', 1)),
    focusDist: num('focusDist', 9), aperture: num('aperture', 0), maxSamples: Math.max(1, num('maxSamples', 2000)|0),
    sunAz: num('sunAz', 35), sunEl: num('sunEl', 40), sunInt: num('sunInt', 1), rough: num('rough', 0), jitter: num('jitter', 1),
    fogColor: fin3(d.fogColor, [0.8,0.85,0.9]),
    fov: Math.max(1, Math.min(179, num('fov', 50))),
    bgTop: fin3(d.bgTop, [0.20,0.36,0.66]),
    bgBottom: fin3(d.bgBottom, [0.62,0.70,0.80]),
    debugMode: num('debugMode', 0)|0,
    toneMode: Math.max(0, Math.min(4, num('toneMode', 0))), autoExp: bool('autoExp', false), fogDensity: num('fogDensity', 0), rrOn: bool('rrOn', false),
    denoiseOn: bool('denoiseOn', false), denIters: num('denIters', 3), neeOn: bool('neeOn', true), envInt: num('envInt', 1),
    bloomOn: bool('bloomOn', false), bloomStr: num('bloomStr', 0.6), bloomThr: num('bloomThr', 1.0),
    vignetteOn: bool('vignetteOn', false), vigStr: num('vigStr', 0.5),
    chromaOn: bool('chromaOn', false), chromaStr: Math.max(0, Math.min(2, num('chromaStr', 0.5))),
    grainOn: bool('grainOn', false), grainStr: num('grainStr', 0.08),
    gamma: Math.max(0.1, Math.min(5.0, num('gamma', 2.2))), clampRad: num('clampRad', 0), satStr: num('satStr', 1), contrast: num('contrast', 1), sharpen: num('sharpen', 0), dither: num('dither', 0), temp: Math.max(-1, Math.min(1, num('temp', 0))), hue: num('hue', 0), sepia: num('sepia', 0), posterize: num('posterize', 0), letterbox: num('letterbox', 0), scanline: num('scanline', 0), invert: num('invert', 0), border: num('border', 0), bright: num('bright', 0), duotone: Math.max(0, Math.min(1, num('duotone', 0))),     vibrance: num('vibrance', 0), mono: num('mono', 0), tint: num('tint', 0), balance: num('balance', 0), bleach: num('bleach', 0), fade: num('fade', 0), splittone: num('splittone', 0), highlights: num('highlights', 0), glow: num('glow', 0), solarize: num('solarize', 0), expose: num('expose', 0), threshold: num('threshold', 0), crossprocess: num('crossprocess', 0), falsecolor: num('falsecolor', 0), gradientmap: num('gradientmap', 0), pastel: num('pastel', 0), infrared: num('infrared', 0), radial: num('radial', 0), swirl: num('swirl', 0), night: num('night', 0), emboss: num('emboss', 0), edge: num('edge', 0), pixelate: num('pixelate', 0), rgbshift: num('rgbshift', 0), halftone: num('halftone', 0), techni: num('techni', 0), vhs: num('vhs', 0), colorkey: num('colorkey', 0), anaglyph: num('anaglyph', 0), oil: num('oil', 0), lomo: num('lomo', 0), leak: num('leak', 0), wave: num('wave', 0), cnoise: num('cnoise', 0), kaleido: num('kaleido', 0), ripple: num('ripple', 0), huequant: num('huequant', 0), lift: num('lift', 0), hsat: num('hsat', 0), fisheye: num('fisheye', 0), pointOn: bool('pointOn', false), pointPos: fin3(d.pointPos, [3,4,-2]), pointColor: fin3(d.pointColor, [1,0.9,0.8]), pointInt: Math.max(0, num('pointInt', 8)), glitch: num('glitch', 0), cyanotype: num('cyanotype', 0), selenium: num('selenium', 0), moonlight: num('moonlight', 0), verdigris: num('verdigris', 0), rosegold: num('rosegold', 0), aurora: num('aurora', 0), amber: num('amber', 0), watercolor: Math.max(0, Math.min(1, num('watercolor', 0))), pixelSize: Math.max(0, Math.min(1, num('pixelSize', 0))), hueShift: Math.max(-180, Math.min(180, num('hueShift', 0))), duotoneShadow: fin3(d.duotoneShadow, [0.05,0.0,0.1]), duotoneHigh: fin3(d.duotoneHigh, [1.0,0.9,0.7]), chromaAmt: Math.max(0, Math.min(1, num('chromaAmt', 0.5)))
  };
}
let avgBuf=null;
const $ = id=>document.getElementById(id);
// 十六进制颜色 <-> 线性 RGB(0..1) 互转，供雾颜色取色器使用
const hex2rgb = h => [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
const rgb2hex = c => '#' + c.map(v=>Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('');
// 由方位角/高度角计算太阳单位方向向量（el 为地平线以上仰角；结果单位长度）
function computeSunDir(azDeg, elDeg){
  const az = azDeg * Math.PI/180, el = elDeg * Math.PI/180;
  const ce = Math.cos(el);
  return [ce*Math.sin(az), Math.sin(el), ce*Math.cos(az)];
}
// ---------- 场景预设画廊：命名化的「几何 + 相机 + 渲染参数」全套配置 ----------
const PRESETS = [
  { name:'经典展厅', sceneId:0, theta:0.6, phi:0.4, radius:11, target:[0,1.5,0], maxBounces:6, resScale:1, exposure:1.0, focusDist:9, aperture:0, maxSamples:2000, toneMode:0, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:true, envInt:1, bloomOn:false, bloomStr:0.6, bloomThr:1.0 },
  { name:'电影感夜景', sceneId:2, theta:0.9, phi:0.3, radius:9, target:[0,1,0], maxBounces:8, resScale:1, exposure:0.7, focusDist:6, aperture:0.02, maxSamples:3000, toneMode:3, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:4, neeOn:true, envInt:0.6, bloomOn:true, bloomStr:0.9, bloomThr:0.8, chromaAmt:0.5 },
  { name:'极简高光', sceneId:1, theta:0.4, phi:0.5, radius:13, target:[0,0,0], maxBounces:4, resScale:1, exposure:1.4, focusDist:12, aperture:0, maxSamples:1500, toneMode:1, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:false, envInt:1.2, bloomOn:false, bloomStr:0.6, bloomThr:1.0, pixelSize:0.4 },
  { name:'玻璃特写', sceneId:6, theta:0.7, phi:0.35, radius:6, target:[0,0.5,0], maxBounces:12, resScale:1, exposure:1.0, focusDist:3.2, aperture:0.05, maxSamples:4000, toneMode:0, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:3, neeOn:true, envInt:1, bloomOn:false, bloomStr:0.6, bloomThr:1.0 },
  { name:'行星远眺', sceneId:5, theta:1.1, phi:0.2, radius:16, target:[0,0,0], maxBounces:6, resScale:1, exposure:1.1, focusDist:14, aperture:0, maxSamples:2500, toneMode:2, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:true, envInt:1, bloomOn:true, bloomStr:0.5, bloomThr:0.9 },
  // ci341 预设：月夜极光——月光冷银蓝基调 + 极光渐变点缀 + 泛光, 夜景氛围
  { name:'月夜极光', sceneId:2, theta:1.0, phi:0.25, radius:10, target:[0,1,0], maxBounces:8, resScale:1, exposure:0.85, focusDist:7, aperture:0, maxSamples:3000, toneMode:3, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:4, neeOn:true, envInt:0.7, bloomOn:true, bloomStr:0.8, bloomThr:0.75, moonlight:0.55, aurora:0.4, vignetteOn:true, vigStr:0.45 },
  // ci345 预设：铜绿古董——铜锈青绿色调 + 褪色 + 暗角, 博物馆藏品质感
  { name:'铜绿古董', sceneId:0, theta:0.5, phi:0.45, radius:12, target:[0,1.5,0], maxBounces:6, resScale:1, exposure:1.0, focusDist:9, aperture:0, maxSamples:2200, toneMode:1, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:true, denIters:3, neeOn:true, envInt:0.9, bloomOn:false, bloomStr:0.6, bloomThr:1.0, verdigris:0.6, fade:0.25, vignetteOn:true, vigStr:0.5, duotoneShadow:[0.10,0.12,0.20], duotoneHigh:[0.95,0.85,0.60] },
  // ci349 预设：玫瑰暖调——玫瑰金高光 + 柔光 + 自然饱和, 人像/静物暖氛围
  { name:'玫瑰暖调', sceneId:6, theta:0.65, phi:0.35, radius:7, target:[0,0.5,0], maxBounces:10, resScale:1, exposure:1.1, focusDist:4, aperture:0.03, maxSamples:2800, toneMode:0, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:3, neeOn:true, envInt:1.05, bloomOn:true, bloomStr:0.55, bloomThr:0.9, rosegold:0.5, glow:0.2, vibrance:0.3, watercolor:0.35 },
  // ci353 预设：琥珀余晖——琥珀单色调 + 暖色温 + 泛光, 黄昏怀旧氛围
  { name:'琥珀余晖', sceneId:5, theta:1.2, phi:0.18, radius:15, target:[0,0,0], maxBounces:6, resScale:1, exposure:1.05, focusDist:13, aperture:0, maxSamples:2400, toneMode:2, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:true, envInt:1, bloomOn:true, bloomStr:0.6, bloomThr:0.85, amber:0.65, temp:0.15, vignetteOn:true, vigStr:0.4, hueShift:15 }
];
// 纯函数：将预设对象归一化为完整参数（带类型守卫），供应用与测试复用
function presetToParams(p){
  const num = (v, d)=> (typeof v === 'number' && isFinite(v)) ? v : d;
  const bool = (v)=> v === true;
  const arr3 = (v)=> (Array.isArray(v) && v.length === 3) ? [Number(v[0]), Number(v[1]), Number(v[2])] : [0,0,0];
  const fin3 = (v, def)=> (Array.isArray(v) && v.length===3 && v.every(x=>typeof x==='number' && isFinite(x))) ? v.map(Number) : def;
  return {
    sceneId: num(p.sceneId, 0)|0, theta: num(p.theta, 0), phi: num(p.phi, 0), radius: num(p.radius, 10),
    target: arr3(p.target), maxBounces: num(p.maxBounces, 6)|0, resScale: num(p.resScale, 1),
    exposure: Math.max(0, num(p.exposure, 1)), focusDist: num(p.focusDist, 9), aperture: num(p.aperture, 0),
    sunAz: num(p.sunAz, 35), sunEl: num(p.sunEl, 40), sunInt: num(p.sunInt, 1), rough: num(p.rough, 0), jitter: num(p.jitter, 1),
    fogColor: fin3(p.fogColor, [0.8,0.85,0.9]),
    fov: Math.max(1, Math.min(179, num(p.fov, 50))),
    bgTop: fin3(p.bgTop, [0.20,0.36,0.66]),
    bgBottom: fin3(p.bgBottom, [0.62,0.70,0.80]),
    debugMode: num(p.debugMode, 0)|0,
    maxSamples: Math.max(1, num(p.maxSamples, 2000)|0), toneMode: Math.max(0, Math.min(4, num(p.toneMode, 0)|0)), autoExp: bool(p.autoExp),
    fogDensity: num(p.fogDensity, 0), rrOn: bool(p.rrOn), denoiseOn: bool(p.denoiseOn), denIters: num(p.denIters, 3)|0,
    neeOn: bool(p.neeOn), envInt: num(p.envInt, 1), bloomOn: bool(p.bloomOn), bloomStr: num(p.bloomStr, 0.6), bloomThr: num(p.bloomThr, 1),
    vignetteOn: bool(p.vignetteOn), vigStr: num(p.vigStr, 0.5),
    gamma: Math.max(0.1, Math.min(5.0, num(p.gamma, 2.2))), clampRad: num(p.clampRad, 0), satStr: num(p.satStr, 1), contrast: num(p.contrast, 1), sharpen: num(p.sharpen, 0), dither: num(p.dither, 0), temp: Math.max(-1, Math.min(1, num(p.temp, 0))), hue: num(p.hue, 0), sepia: num(p.sepia, 0), posterize: num(p.posterize, 0), letterbox: num(p.letterbox, 0), scanline: num(p.scanline, 0), invert: num(p.invert, 0), border: num(p.border, 0), bright: num(p.bright, 0), duotone: Math.max(0, Math.min(1, num(p.duotone, 0))),     vibrance: num(p.vibrance, 0), mono: num(p.mono, 0), tint: num(p.tint, 0), balance: num(p.balance, 0), bleach: num(p.bleach, 0), fade: num(p.fade, 0), splittone: num(p.splittone, 0), highlights: num(p.highlights, 0), glow: num(p.glow, 0), solarize: num(p.solarize, 0), expose: num(p.expose, 0), threshold: num(p.threshold, 0), crossprocess: num(p.crossprocess, 0), falsecolor: num(p.falsecolor, 0), gradientmap: num(p.gradientmap, 0), pastel: num(p.pastel, 0), infrared: num(p.infrared, 0), radial: num(p.radial, 0), swirl: num(p.swirl, 0), night: num(p.night, 0), emboss: num(p.emboss, 0), edge: num(p.edge, 0), pixelate: num(p.pixelate, 0), rgbshift: num(p.rgbshift, 0), halftone: num(p.halftone, 0), techni: num(p.techni, 0), vhs: num(p.vhs, 0), colorkey: num(p.colorkey, 0), anaglyph: num(p.anaglyph, 0), oil: num(p.oil, 0), lomo: num(p.lomo, 0), leak: num(p.leak, 0), wave: num(p.wave, 0), cnoise: num(p.cnoise, 0), kaleido: num(p.kaleido, 0), ripple: num(p.ripple, 0), huequant: num(p.huequant, 0), lift: num(p.lift, 0), hsat: num(p.hsat, 0), fisheye: num(p.fisheye, 0), pointOn: bool(p.pointOn), pointPos: arr3(p.pointPos), pointColor: arr3(p.pointColor), pointInt: Math.max(0, num(p.pointInt, 8)), glitch: num(p.glitch, 0), cyanotype: num(p.cyanotype, 0), selenium: num(p.selenium, 0), moonlight: num(p.moonlight, 0), verdigris: num(p.verdigris, 0), rosegold: num(p.rosegold, 0), aurora: num(p.aurora, 0), amber: num(p.amber, 0), chromaOn: bool(p.chromaOn), chromaStr: Math.max(0, Math.min(2, num(p.chromaStr, 0.5))), watercolor: Math.max(0, Math.min(1, num(p.watercolor, 0))), pixelSize: Math.max(0, Math.min(1, num(p.pixelSize, 0))), hueShift: Math.max(-180, Math.min(180, num(p.hueShift, 0))), duotoneShadow: fin3(p.duotoneShadow, [0.05,0.0,0.1]), duotoneHigh: fin3(p.duotoneHigh, [1.0,0.9,0.7]), chromaAmt: Math.max(0, Math.min(1, num(p.chromaAmt, 0.5)))
  };
}
function applyPreset(idx){
  const p = PRESETS[idx]; if(!p) return;
  const s = presetToParams(p);
  sceneId=s.sceneId; theta=s.theta; phi=s.phi; radius=s.radius; target=s.target.slice();
  maxBounces=s.maxBounces; resScale=s.resScale; exposure=s.exposure; focusDist=s.focusDist; aperture=s.aperture;
  sunAz=s.sunAz; sunEl=s.sunEl; sunInt=s.sunInt; rough=s.rough; jitter=s.jitter; fogColor=s.fogColor ? s.fogColor.slice() : [0.8,0.85,0.9]; fov=s.fov; bgTop=s.bgTop ? s.bgTop.slice() : [0.20,0.36,0.66]; bgBottom=s.bgBottom ? s.bgBottom.slice() : [0.62,0.70,0.80]; debugMode=s.debugMode;
  maxSamples=s.maxSamples; toneMode=s.toneMode; autoExp=s.autoExp; fogDensity=s.fogDensity; rrOn=s.rrOn;
  denoiseOn=s.denoiseOn; denIters=s.denIters; neeOn=s.neeOn; envInt=s.envInt; bloomOn=s.bloomOn; bloomStr=s.bloomStr; bloomThr=s.bloomThr;
vignetteOn=s.vignetteOn; vigStr=s.vigStr; gamma=s.gamma; clampRad=s.clampRad; satStr=s.satStr; contrast=s.contrast; sharpen=s.sharpen; dither=s.dither; temp=s.temp; hue=s.hue; sepia=s.sepia; posterize=s.posterize; letterbox=s.letterbox; scanline=s.scanline; invert=s.invert; border=s.border; bright=s.bright; duotone=s.duotone; vibrance=s.vibrance; mono=s.mono; tint=s.tint; balance=s.balance; bleach=s.bleach; fade=s.fade; splittone=s.splittone; highlights=s.highlights; glow=s.glow; solarize=s.solarize; expose=s.expose; threshold=s.threshold; crossprocess=s.crossprocess; falsecolor=s.falsecolor; gradientmap=s.gradientmap; pastel=s.pastel; infrared=s.infrared; radial=s.radial; swirl=s.swirl; night=s.night; emboss=s.emboss; edge=s.edge; pixelate=s.pixelate; rgbshift=s.rgbshift; halftone=s.halftone; techni=s.techni; vhs=s.vhs; colorkey=s.colorkey; anaglyph=s.anaglyph; oil=s.oil; lomo=s.lomo; leak=s.leak; wave=s.wave; cnoise=s.cnoise; kaleido=s.kaleido; ripple=s.ripple; huequant=s.huequant; lift=s.lift; hsat=s.hsat; fisheye=s.fisheye; pointOn=s.pointOn; pointPos=s.pointPos; pointColor=s.pointColor; pointInt=s.pointInt; glitch=s.glitch; cyanotype=s.cyanotype; selenium=s.selenium; moonlight=s.moonlight; verdigris=s.verdigris; rosegold=s.rosegold; aurora=s.aurora; amber=s.amber; chromaOn=s.chromaOn; chromaStr=s.chromaStr; watercolor=s.watercolor; pixelSize=s.pixelSize; hueShift=s.hueShift; duotoneShadow=s.duotoneShadow.slice(); duotoneHigh=s.duotoneHigh.slice(); chromaAmt=s.chromaAmt;
  syncSceneUI(); clearAccum();
}
$('scene').onchange = e=>{
  sceneId=+e.target.value;
  if(sceneId===4){ focusDist=3.2; $('focus').value=3.2; $('focusVal').textContent='3.2'; }
  clearAccum();
};
$('bounces').oninput = e=>{ maxBounces=+e.target.value; $('bouncesVal').textContent=maxBounces; clearAccum(); };
$('res').oninput = e=>{ resScale=+e.target.value/100; $('resVal').textContent=resScale.toFixed(2)+'x'; allocBuffers(); };
$('env').oninput = e=>{ envInt=+e.target.value; $('envVal').textContent=envInt.toFixed(1); clearAccum(); };
$('exp').oninput = e=>{ exposure=+e.target.value; $('expVal').textContent=exposure.toFixed(1); };
$('focus').oninput = e=>{ focusDist=+e.target.value; $('focusVal').textContent=focusDist.toFixed(1); clearAccum(); };
$('ap').oninput = e=>{ aperture=+e.target.value/100; $('apVal').textContent=aperture.toFixed(2); clearAccum(); };
$('sunAz').oninput = e=>{ sunAz=+e.target.value; $('sunAzVal').textContent=sunAz; clearAccum(); };
$('sunEl').oninput = e=>{ sunEl=+e.target.value; $('sunElVal').textContent=sunEl; clearAccum(); };
$('sunInt').oninput = e=>{ sunInt=+e.target.value/100; $('sunIntVal').textContent=sunInt.toFixed(2); clearAccum(); };
$('rough').oninput = e=>{ rough=+e.target.value/100; $('roughVal').textContent=rough.toFixed(2); clearAccum(); };
$('jitter').oninput = e=>{ jitter=+e.target.value/100; $('jitterVal').textContent=jitter.toFixed(2); clearAccum(); };
$('reset').onclick = ()=> clearAccum();
$('pause').onclick = ()=> paused=!paused;
$('rotate').onclick = ()=> autoRotate = !autoRotate;
$('save').onclick = ()=>{
  const a = document.createElement('a');
  a.download = 'lumen_scene' + sceneId + '_spp' + frame + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
};
$('maxspp').oninput = e=>{ maxSamples = +e.target.value; $('maxsppVal').textContent = maxSamples; };
// ---------- 场景预设导出 / 导入 ----------
function downloadBlob(name, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function syncSceneUI(){
  if($('scene')) $('scene').value = String(sceneId);
  if($('tone')) $('tone').value = String(toneMode);
  if($('fog')) $('fog').value = fogDensity;
  if($('fogColor')) $('fogColor').value = rgb2hex(fogColor);
  if($('fov')){ $('fov').value = fov; if($('fovVal')) $('fovVal').textContent = fov + '°'; }
  if($('bgTop')) $('bgTop').value = rgb2hex(bgTop);
  if($('bgBottom')) $('bgBottom').value = rgb2hex(bgBottom);
  if($('debug')) $('debug').value = String(debugMode);
  if($('rr')) $('rr').checked = rrOn;
  if($('denoise')) $('denoise').checked = denoiseOn;
  if($('nee')) $('nee').checked = neeOn;
  if($('bloom')) $('bloom').checked = bloomOn;
  if($('denIters')) $('denIters').value = denIters;
  if($('bloomStr')) $('bloomStr').value = Math.round(bloomStr * 100);
  if($('bloomThr')) $('bloomThr').value = Math.round(bloomThr * 100);
  if($('vignette')) $('vignette').checked = vignetteOn;
  if($('vigStr')) $('vigStr').value = Math.round(vigStr * 100);
  if($('chroma')) $('chroma').checked = chromaOn;
  if($('chromaStr')) $('chromaStr').value = Math.round(chromaStr * 100);
  if($('grain')) $('grain').checked = grainOn;
  if($('grainStr')) $('grainStr').value = Math.round(grainStr * 100);
  if($('gamma')) $('gamma').value = Math.round(gamma * 100);
  if($('firefly')) $('firefly').value = clampRad;
  if($('satStr')) $('satStr').value = Math.round(satStr * 100);
  if($('contrast')) $('contrast').value = Math.round(contrast * 100);
  if($('sharpen')) $('sharpen').value = Math.round(sharpen * 100);
  if($('dither')) $('dither').value = Math.round(dither * 100);
  if($('temp')) $('temp').value = Math.round(temp * 100);
  if($('hue')) $('hue').value = Math.round(hue);
  if($('sepia')) $('sepia').value = Math.round(sepia * 100);
  if($('posterize')) $('posterize').value = posterize;
  if($('letterbox')) $('letterbox').value = Math.round(letterbox * 100);
  if($('scanline')) $('scanline').value = Math.round(scanline * 100);
  if($('invert')) $('invert').value = Math.round(invert * 100);
  if($('border')) $('border').value = Math.round(border * 100);
  if($('bright')) $('bright').value = Math.round(bright * 100);
  if($('duotone')) $('duotone').value = Math.round(duotone * 100);
  if($('vibrance')) $('vibrance').value = Math.round(vibrance * 100);
  if($('mono')) $('mono').value = Math.round(mono * 100);
  if($('tint')) $('tint').value = Math.round(tint * 100);
  if($('balance')) $('balance').value = Math.round(balance * 100);
  if($('bleach')) $('bleach').value = Math.round(bleach * 100);
  if($('fade')) $('fade').value = Math.round(fade * 100);
  if($('splittone')) $('splittone').value = Math.round(splittone * 100);
  if($('highlights')) $('highlights').value = Math.round(highlights * 100);
  if($('glow')) $('glow').value = Math.round(glow * 100);
  if($('solarize')) $('solarize').value = Math.round(solarize * 100);
  if($('expose')) $('expose').value = Math.round(expose * 100);
  if($('threshold')) $('threshold').value = Math.round(threshold * 100);
  if($('crossprocess')) $('crossprocess').value = Math.round(crossprocess * 100);
  if($('falsecolor')) $('falsecolor').value = Math.round(falsecolor * 100);
  if($('gradientmap')) $('gradientmap').value = Math.round(gradientmap * 100);
  if($('pastel')) $('pastel').value = Math.round(pastel * 100);
  if($('infrared')) $('infrared').value = Math.round(infrared * 100);
  if($('radial')) $('radial').value = Math.round(radial * 100);
  if($('swirl')) $('swirl').value = Math.round(swirl * 100);
  if($('night')) $('night').value = Math.round(night * 100);
  if($('emboss')) $('emboss').value = Math.round(emboss * 100);
  if($('edge')) $('edge').value = Math.round(edge * 100);
  if($('pixelate')) $('pixelate').value = Math.round(pixelate * 100);
  if($('rgbshift')) $('rgbshift').value = Math.round(rgbshift * 100);
  if($('techni')) $('techni').value = Math.round(techni * 100);
  if($('vhs')) $('vhs').value = Math.round(vhs * 100);
  if($('colorkey')) $('colorkey').value = Math.round(colorkey * 100);
  if($('anaglyph')) $('anaglyph').value = Math.round(anaglyph * 100);
  if($('halftone')) $('halftone').value = Math.round(halftone * 100);
  if($('oil')) $('oil').value = Math.round(oil * 100);
  if($('lomo')) $('lomo').value = Math.round(lomo * 100);
  if($('leak')) $('leak').value = Math.round(leak * 100);
  if($('wave')) $('wave').value = Math.round(wave * 100);
  if($('cnoise')) $('cnoise').value = Math.round(cnoise * 100);
  if($('kaleido')) $('kaleido').value = Math.round(kaleido * 100);
  if($('ripple')) $('ripple').value = Math.round(ripple * 100);
  if($('huequant')) $('huequant').value = Math.round(huequant * 100);
  if($('lift')) $('lift').value = Math.round(lift * 100);
  if($('hsat')) $('hsat').value = Math.round(hsat * 100);
  if($('glitch')) $('glitch').value = Math.round(glitch * 100);
  if($('cyanotype')) $('cyanotype').value = Math.round(cyanotype * 100);
  if($('selenium')) $('selenium').value = Math.round(selenium * 100);
  if($('moonlight')) $('moonlight').value = Math.round(moonlight * 100);
  if($('verdigris')) $('verdigris').value = Math.round(verdigris * 100);
  if($('rosegold')) $('rosegold').value = Math.round(rosegold * 100);
  if($('aurora')) $('aurora').value = Math.round(aurora * 100);
  if($('amber')) $('amber').value = Math.round(amber * 100);
  if($('watercolor')) $('watercolor').value = Math.round(watercolor * 100);
  if($('pixelSize')) $('pixelSize').value = Math.round(pixelSize * 100);
  if($('hueShift')) $('hueShift').value = Math.round(hueShift);
  if($('duotoneShadow')) $('duotoneShadow').value = rgb2hex(duotoneShadow);
  if($('duotoneHigh')) $('duotoneHigh').value = rgb2hex(duotoneHigh);
  if($('chromaAmt')) $('chromaAmt').value = Math.round(chromaAmt * 100);
  if($('fisheye')) $('fisheye').value = Math.round(fisheye * 100);
  if($('pointOn')) $('pointOn').checked = pointOn;
  if($('pointInt')) $('pointInt').value = Math.round(pointInt * 10);
  if($('ap')) $('ap').value = Math.round(aperture * 100);
  if($('sunAz')){ $('sunAz').value = Math.round(sunAz); if($('sunAzVal')) $('sunAzVal').textContent=Math.round(sunAz); }
  if($('sunEl')){ $('sunEl').value = Math.round(sunEl); if($('sunElVal')) $('sunElVal').textContent=Math.round(sunEl); }
  if($('sunInt')){ $('sunInt').value = Math.round(sunInt * 100); if($('sunIntVal')) $('sunIntVal').textContent=sunInt.toFixed(2); }
  if($('rough')){ $('rough').value = Math.round(rough * 100); if($('roughVal')) $('roughVal').textContent=rough.toFixed(2); }
  if($('jitter')){ $('jitter').value = Math.round(jitter * 100); if($('jitterVal')) $('jitterVal').textContent=jitter.toFixed(2); }
  if($('maxspp')) $('maxspp').value = maxSamples;
  if($('exp') && $('expVal')){ $('exp').value = exposure; $('expVal').textContent = exposure.toFixed(1); }
  if($('focus') && $('focusVal')){ $('focus').value = focusDist; $('focusVal').textContent = focusDist.toFixed(1); }
}
$('exportScene').onclick = ()=>{
  const s = serializeScene({ sceneId, theta, phi, radius, target, maxBounces, resScale, exposure,
    focusDist, aperture, maxSamples, sunAz, sunEl, sunInt, rough, jitter, fogColor, fov, bgTop, bgBottom, debugMode, toneMode, autoExp, fogDensity, rrOn, denoiseOn, denIters, neeOn, envInt, bloomOn, bloomStr, bloomThr, vignetteOn, vigStr, chromaOn, chromaStr, grainOn, grainStr, gamma, clampRad, satStr, contrast, sharpen, dither, temp, hue, sepia, posterize, letterbox, scanline, invert, border, bright, duotone, vibrance, mono, tint, balance, bleach, fade, splittone, highlights, glow, solarize, expose, threshold, crossprocess, falsecolor, gradientmap, pastel, infrared, radial, swirl, night, emboss, edge, pixelate, rgbshift, halftone, techni, vhs, colorkey, anaglyph, oil, lomo, leak, wave, cnoise, kaleido, ripple, huequant, lift, hsat, pointOn, pointPos, pointColor, pointInt, glitch, cyanotype, selenium, moonlight, verdigris, rosegold, aurora, amber, fisheye, watercolor, pixelSize, hueShift, duotoneShadow, duotoneHigh, chromaAmt });
  downloadBlob('lumen_scene.json', new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
};
$('importScene').onclick = ()=> $('sceneFile').click();
$('sceneFile').onchange = e=>{
  const f = e.target.files && e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const d = JSON.parse(r.result); const s = deserializeScene(d);
      sceneId=s.sceneId; theta=s.theta; phi=s.phi; radius=s.radius; target=s.target;
      maxBounces=s.maxBounces; resScale=s.resScale; exposure=s.exposure; focusDist=s.focusDist; aperture=s.aperture;
      sunAz=s.sunAz; sunEl=s.sunEl; sunInt=s.sunInt; rough=s.rough; jitter=s.jitter; fogColor=s.fogColor ? s.fogColor.slice() : [0.8,0.85,0.9]; fov=s.fov; bgTop=s.bgTop ? s.bgTop.slice() : [0.20,0.36,0.66]; bgBottom=s.bgBottom ? s.bgBottom.slice() : [0.62,0.70,0.80]; debugMode=s.debugMode;
      maxSamples=s.maxSamples; toneMode=s.toneMode; autoExp=s.autoExp; fogDensity=s.fogDensity; rrOn=s.rrOn;
      denoiseOn=s.denoiseOn; denIters=s.denIters; neeOn=s.neeOn; envInt=s.envInt; bloomOn=s.bloomOn; bloomStr=s.bloomStr; bloomThr=s.bloomThr;
vignetteOn=s.vignetteOn; vigStr=s.vigStr; chromaOn=s.chromaOn; chromaStr=s.chromaStr; grainOn=s.grainOn; grainStr=s.grainStr; gamma=s.gamma; satStr=s.satStr; contrast=s.contrast; sharpen=s.sharpen; dither=s.dither; temp=s.temp; hue=s.hue; sepia=s.sepia; posterize=s.posterize; letterbox=s.letterbox; scanline=s.scanline; invert=s.invert; border=s.border; bright=s.bright; duotone=s.duotone; vibrance=s.vibrance; mono=s.mono; tint=s.tint; balance=s.balance; bleach=s.bleach; fade=s.fade; splittone=s.splittone; highlights=s.highlights; glow=s.glow; solarize=s.solarize; expose=s.expose; threshold=s.threshold; crossprocess=s.crossprocess; falsecolor=s.falsecolor; gradientmap=s.gradientmap; pastel=s.pastel; infrared=s.infrared; radial=s.radial; swirl=s.swirl; night=s.night; emboss=s.emboss; edge=s.edge; pixelate=s.pixelate; rgbshift=s.rgbshift; halftone=s.halftone; techni=s.techni; vhs=s.vhs; colorkey=s.colorkey; anaglyph=s.anaglyph; oil=s.oil; lomo=s.lomo; leak=s.leak; wave=s.wave; cnoise=s.cnoise; kaleido=s.kaleido; ripple=s.ripple; huequant=s.huequant; lift=s.lift; hsat=s.hsat; fisheye=s.fisheye; pointOn=s.pointOn; pointPos=s.pointPos; pointColor=s.pointColor; pointInt=s.pointInt; glitch=s.glitch; cyanotype=s.cyanotype; selenium=s.selenium; moonlight=s.moonlight; verdigris=s.verdigris; rosegold=s.rosegold; aurora=s.aurora; amber=s.amber; chromaOn=s.chromaOn; chromaStr=s.chromaStr; watercolor=s.watercolor; pixelSize=s.pixelSize; hueShift=s.hueShift; duotoneShadow=s.duotoneShadow.slice(); duotoneHigh=s.duotoneHigh.slice(); chromaAmt=s.chromaAmt;
      syncSceneUI(); clearAccum();
    }catch(err){ /* 解析失败静默忽略 */ }
  };
  r.readAsText(f); e.target.value = '';
};
$('tone').onchange = e=>{ toneMode = +e.target.value; };
$('preset').onchange = e=>{ applyPreset(+e.target.value); };
$('autoexp').onchange = e=>{ autoExp = e.target.checked; };
$('fog').oninput = e=>{ fogDensity = +e.target.value; $('fogVal').textContent = fogDensity.toFixed(2); clearAccum(); };
$('fogColor').oninput = e=>{ fogColor = hex2rgb(e.target.value); clearAccum(); };
$('fov').oninput = e=>{ fov = +e.target.value; if($('fovVal')) $('fovVal').textContent = fov + '°'; clearAccum(); };
$('fisheye').oninput = e=>{ fisheye = +e.target.value/100; if($('fisheyeVal')) $('fisheyeVal').textContent = fisheye.toFixed(2); clearAccum(); };
$('pointOn').onchange = e=>{ pointOn = e.target.checked; clearAccum(); };
$('pointInt').oninput = e=>{ pointInt = +e.target.value/10; if($('pointIntVal')) $('pointIntVal').textContent = pointInt.toFixed(1); clearAccum(); };
$('bgTop').oninput = e=>{ bgTop = hex2rgb(e.target.value); clearAccum(); };
$('bgBottom').oninput = e=>{ bgBottom = hex2rgb(e.target.value); clearAccum(); };
$('debug').onchange = e=>{ debugMode = +e.target.value; clearAccum(); };
$('firefly').oninput = e=>{ clampRad = +e.target.value; $('fireflyVal') && ($('fireflyVal').textContent = clampRad); clearAccum(); };
$('rr').onchange = e=>{ rrOn = e.target.checked; clearAccum(); };
$('denoise').onchange = e=>{ denoiseOn = e.target.checked; };
$('nee').onchange = e=>{ neeOn = e.target.checked; clearAccum(); };
$('denIters').oninput = e=>{ denIters=+e.target.value; $('denItersVal').textContent=denIters; };
$('bloom').onchange = e=>{ bloomOn = e.target.checked; };   // 后处理, 无需清累积
$('bloomStr').oninput = e=>{ bloomStr=+e.target.value/100; $('bloomStrVal').textContent=bloomStr.toFixed(2); };
$('bloomThr').oninput = e=>{ bloomThr=+e.target.value/100; $('bloomThrVal').textContent=bloomThr.toFixed(2); };
$('vignette').onchange = e=>{ vignetteOn = e.target.checked; };   // 后处理, 无需清累积
$('vigStr').oninput = e=>{ vigStr=+e.target.value/100; $('vigStrVal').textContent=vigStr.toFixed(2); };
$('gamma').oninput = e=>{ gamma=+e.target.value/100; $('gammaVal').textContent=gamma.toFixed(2); };
$('chroma').onchange = e=>{ chromaOn = e.target.checked; };   // 后处理, 无需清累积
$('chromaStr').oninput = e=>{ chromaStr=+e.target.value/100; $('chromaStrVal').textContent=chromaStr.toFixed(2); };
$('grain').onchange = e=>{ grainOn = e.target.checked; };   // 后处理, 无需清累积
$('grainStr').oninput = e=>{ grainStr=+e.target.value/100; $('grainStrVal').textContent=grainStr.toFixed(2); };
$('satStr').oninput = e=>{ satStr=+e.target.value/100; $('satStrVal').textContent=satStr.toFixed(2); };
$('contrast').oninput = e=>{ contrast=+e.target.value/100; $('contrastVal').textContent=contrast.toFixed(2); };
$('sharpen').oninput = e=>{ sharpen=+e.target.value/100; $('sharpenVal').textContent=sharpen.toFixed(2); };
$('dither').oninput = e=>{ dither=+e.target.value/100; $('ditherVal').textContent=dither.toFixed(2); };
$('temp').oninput = e=>{ temp=+e.target.value/100; $('tempVal').textContent=temp.toFixed(2); };
$('hue').oninput = e=>{ hue=+e.target.value; $('hueVal').textContent=hue.toFixed(0); };
$('sepia').oninput = e=>{ sepia=+e.target.value/100; $('sepiaVal').textContent=sepia.toFixed(2); };
$('posterize').oninput = e=>{ posterize=+e.target.value; $('posterizeVal').textContent = (posterize >= 2 ? posterize + ' 级' : '关'); };
$('letterbox').oninput = e=>{ letterbox=+e.target.value/100; $('letterboxVal').textContent=letterbox.toFixed(2); };
$('scanline').oninput = e=>{ scanline=+e.target.value/100; $('scanlineVal').textContent=scanline.toFixed(2); };
$('invert').oninput = e=>{ invert=+e.target.value/100; $('invertVal').textContent=invert.toFixed(2); };
$('border').oninput = e=>{ border=+e.target.value/100; $('borderVal').textContent=border.toFixed(2); };
$('bright').oninput = e=>{ bright=+e.target.value/100; $('brightVal').textContent=bright.toFixed(2); };
$('duotone').oninput = e=>{ duotone=+e.target.value/100; $('duotoneVal').textContent=duotone.toFixed(2); };
$('vibrance').oninput = e=>{ vibrance=+e.target.value/100; $('vibranceVal').textContent=vibrance.toFixed(2); };
$('mono').oninput = e=>{ mono=+e.target.value/100; $('monoVal').textContent=mono.toFixed(2); };
$('tint').oninput = e=>{ tint=+e.target.value/100; $('tintVal').textContent=tint.toFixed(2); };
$('balance').oninput = e=>{ balance=+e.target.value/100; $('balanceVal').textContent=balance.toFixed(2); };
$('bleach').oninput = e=>{ bleach=+e.target.value/100; $('bleachVal').textContent=bleach.toFixed(2); };
$('fade').oninput = e=>{ fade=+e.target.value/100; $('fadeVal').textContent=fade.toFixed(2); };
$('splittone').oninput = e=>{ splittone=+e.target.value/100; $('splittoneVal').textContent=splittone.toFixed(2); };
$('highlights').oninput = e=>{ highlights=+e.target.value/100; $('highlightsVal').textContent=highlights.toFixed(2); };
$('glow').oninput = e=>{ glow=+e.target.value/100; $('glowVal').textContent=glow.toFixed(2); };
$('solarize').oninput = e=>{ solarize=+e.target.value/100; $('solarizeVal').textContent=solarize.toFixed(2); };
$('expose').oninput = e=>{ expose=+e.target.value/100; $('exposeVal').textContent=expose.toFixed(2); };
$('threshold').oninput = e=>{ threshold=+e.target.value/100; $('thresholdVal').textContent=threshold.toFixed(2); };
$('crossprocess').oninput = e=>{ crossprocess=+e.target.value/100; $('crossprocessVal').textContent=crossprocess.toFixed(2); };
$('falsecolor').oninput = e=>{ falsecolor=+e.target.value/100; $('falsecolorVal').textContent=falsecolor.toFixed(2); };
$('gradientmap').oninput = e=>{ gradientmap=+e.target.value/100; $('gradientmapVal').textContent=gradientmap.toFixed(2); };
$('pastel').oninput = e=>{ pastel=+e.target.value/100; $('pastelVal').textContent=pastel.toFixed(2); };
$('infrared').oninput = e=>{ infrared=+e.target.value/100; $('infraredVal').textContent=infrared.toFixed(2); };
$('radial').oninput = e=>{ radial=+e.target.value/100; $('radialVal').textContent=radial.toFixed(2); };
$('swirl').oninput = e=>{ swirl=+e.target.value/100; $('swirlVal').textContent=swirl.toFixed(2); };
$('night').oninput = e=>{ night=+e.target.value/100; $('nightVal').textContent=night.toFixed(2); };
$('emboss').oninput = e=>{ emboss=+e.target.value/100; $('embossVal').textContent=emboss.toFixed(2); };
$('edge').oninput = e=>{ edge=+e.target.value/100; $('edgeVal').textContent=edge.toFixed(2); };
$('pixelate').oninput = e=>{ pixelate=+e.target.value/100; $('pixelateVal').textContent=pixelate.toFixed(2); };
$('rgbshift').oninput = e=>{ rgbshift=+e.target.value/100; $('rgbshiftVal').textContent=rgbshift.toFixed(2); };
$('techni').oninput = e=>{ techni=+e.target.value/100; $('techniVal').textContent=techni.toFixed(2); };
$('vhs').oninput = e=>{ vhs=+e.target.value/100; $('vhsVal').textContent=vhs.toFixed(2); };
$('colorkey').oninput = e=>{ colorkey=+e.target.value/100; $('colorkeyVal').textContent=colorkey.toFixed(2); };
$('anaglyph').oninput = e=>{ anaglyph=+e.target.value/100; $('anaglyphVal').textContent=anaglyph.toFixed(2); };
$('halftone').oninput = e=>{ halftone=+e.target.value/100; $('halftoneVal').textContent=halftone.toFixed(2); };
$('oil').oninput = e=>{ oil=+e.target.value/100; $('oilVal').textContent=oil.toFixed(2); };
$('lomo').oninput = e=>{ lomo=+e.target.value/100; $('lomoVal').textContent=lomo.toFixed(2); };
$('leak').oninput = e=>{ leak=+e.target.value/100; $('leakVal').textContent=leak.toFixed(2); };
$('wave').oninput = e=>{ wave=+e.target.value/100; $('waveVal').textContent=wave.toFixed(2); };
$('cnoise').oninput = e=>{ cnoise=+e.target.value/100; $('cnoiseVal').textContent=cnoise.toFixed(2); };
$('kaleido').oninput = e=>{ kaleido=+e.target.value/100; $('kaleidoVal').textContent=kaleido.toFixed(2); };
$('ripple').oninput = e=>{ ripple=+e.target.value/100; $('rippleVal').textContent=ripple.toFixed(2); };
$('huequant').oninput = e=>{ huequant=+e.target.value/100; $('huequantVal').textContent=huequant.toFixed(2); };
$('lift').oninput = e=>{ lift=+e.target.value/100; $('liftVal').textContent=lift.toFixed(2); };
$('hsat').oninput = e=>{ hsat=+e.target.value/100; $('hsatVal').textContent=hsat.toFixed(2); };
$('glitch').oninput = e=>{ glitch=+e.target.value/100; if($('glitchVal')) $('glitchVal').textContent=glitch.toFixed(2); clearAccum(); };
$('cyanotype').oninput = e=>{ cyanotype=+e.target.value/100; if($('cyanotypeVal')) $('cyanotypeVal').textContent=cyanotype.toFixed(2); clearAccum(); };
$('selenium').oninput = e=>{ selenium=+e.target.value/100; if($('seleniumVal')) $('seleniumVal').textContent=selenium.toFixed(2); clearAccum(); };
$('moonlight').oninput = e=>{ moonlight=+e.target.value/100; if($('moonlightVal')) $('moonlightVal').textContent=moonlight.toFixed(2); clearAccum(); };
$('verdigris').oninput = e=>{ verdigris=+e.target.value/100; if($('verdigrisVal')) $('verdigrisVal').textContent=verdigris.toFixed(2); clearAccum(); };
$('rosegold').oninput = e=>{ rosegold=+e.target.value/100; if($('rosegoldVal')) $('rosegoldVal').textContent=rosegold.toFixed(2); clearAccum(); };
$('aurora').oninput = e=>{ aurora=+e.target.value/100; if($('auroraVal')) $('auroraVal').textContent=aurora.toFixed(2); clearAccum(); };
$('amber').oninput = e=>{ amber=+e.target.value/100; if($('amberVal')) $('amberVal').textContent=amber.toFixed(2); clearAccum(); };
$('watercolor').oninput = e=>{ watercolor=+e.target.value/100; if($('watercolorVal')) $('watercolorVal').textContent=watercolor.toFixed(2); clearAccum(); };
$('pixelSize').oninput = e=>{ pixelSize=+e.target.value/100; if($('pixelSizeVal')) $('pixelSizeVal').textContent=pixelSize.toFixed(2); clearAccum(); };
$('hueShift').oninput = e=>{ hueShift=+e.target.value; if($('hueShiftVal')) $('hueShiftVal').textContent=hueShift.toFixed(0); clearAccum(); };
$('duotoneShadow').oninput = e=>{ const c=hex2rgb(e.target.value); if(c.every(v=>isFinite(v))) duotoneShadow=c; clearAccum(); };  // NaN 守卫: 非法 hex 不产生 NaN 数组污染 uniform
$('duotoneHigh').oninput = e=>{ const c=hex2rgb(e.target.value); if(c.every(v=>isFinite(v))) duotoneHigh=c; clearAccum(); };     // NaN 守卫: 同上
$('chromaAmt').oninput = e=>{ chromaAmt=+e.target.value/100; if($('chromaAmtVal')) $('chromaAmtVal').textContent=chromaAmt.toFixed(2); clearAccum(); };
// 导入外部模型：OBJ / glTF（最简解析），替换当前网格并重建 BVH
$('modelFile').addEventListener('change', e=>{
  const file = e.target.files && e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const text = String(reader.result);
      const name = file.name.toLowerCase();
      const tris = name.endsWith('.gltf') ? parseGLTF(JSON.parse(text))
                  : name.endsWith('.obj')  ? parseOBJ(text)
                  : null;
      if(!tris || tris.length === 0){ console.warn('[Lumen] 模型为空或格式不支持'); return; }
      loadModel(tris);
      clearAccum();
    }catch(err){ console.error('[Lumen] 模型解析失败', err); }
  };
  reader.readAsText(file);
});
// 自动曝光：周期性回读累积缓冲中心区块的平均亮度，将曝光归一到目标亮度
function readAvgLum(){
  const W = 64, H = 64;
  if(!avgBuf) avgBuf = new Float32Array(W*H*4);
  const fbo = (frame % 2 === 0) ? fboB : fboA;   // 最新累积所在的 FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readPixels(Math.floor((RW-W)/2), Math.floor((RH-H)/2), W, H, gl.RGBA, gl.FLOAT, avgBuf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let s = 0; const denom = Math.max(frame, 1);
  for(let i=0;i<W*H;i++){ s += Math.max(0, avgBuf[i*4] / denom); }
  return s / (W*H);
}

// ---------- 主循环 ----------
let frame=0, lastT=performance.now(), fpsSmooth=0;
const u = (p,n)=>gl.getUniformLocation(p,n);
function loop(){
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = now-lastT; lastT=now;
  fpsSmooth = fpsSmooth? fpsSmooth*0.9 + (1000/Math.max(dt,1))*0.1 : 1000/Math.max(dt,1);
  if(paused) return;

  const cam = (sceneId===4)
    ? { pos:[0,0,3.2], fwd:[0,0,-1], right:[1,0,0], up:[0,1,0] }
    : camBasis();
  if(autoRotate && sceneId!==4){
    rotAccum++;
    if(rotAccum >= 20){ theta += 0.03; rotAccum = 0; clearAccum(); }
  }
  if(frame < maxSamples){
  // 路径追踪 -> 写入未使用的那张
  gl.bindFramebuffer(gl.FRAMEBUFFER, (frame%2===0)? fboB : fboA);
  gl.viewport(0,0,RW,RH);
  gl.useProgram(ptProg);
  const readTex = (frame%2===0)? texA : texB;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, readTex); gl.uniform1i(u(ptProg,'uPrev'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, meshTex.triTex); gl.uniform1i(u(ptProg,'uTris'), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, meshTex.bvhTex); gl.uniform1i(u(ptProg,'uBVH'), 2);
  gl.uniform2f(u(ptProg,'uRes'), RW, RH);
  gl.uniform1i(u(ptProg,'uSamples'), frame);
  gl.uniform1i(u(ptProg,'uFrame'), frame);
  gl.uniform1i(u(ptProg,'uMaxBounces'), maxBounces);
  gl.uniform1i(u(ptProg,'uScene'), sceneId);
  gl.uniform1i(u(ptProg,'uHasMesh'), HAS_MESH);
  gl.uniform1i(u(ptProg,'uDebug'), debugMode);
  gl.uniform1f(u(ptProg,'uClamp'), clampRad);
  gl.uniform1f(u(ptProg,'uEnv'), envInt);
  gl.uniform3fv(u(ptProg,'uCamPos'), cam.pos);
  gl.uniform3fv(u(ptProg,'uCamRight'), cam.right);
  gl.uniform3fv(u(ptProg,'uCamUp'), cam.up);
  gl.uniform3fv(u(ptProg,'uCamFwd'), cam.fwd);
  gl.uniform1f(u(ptProg,'uFov'), fov*Math.PI/180);
  gl.uniform1f(u(ptProg,'uFisheye'), fisheye);
  gl.uniform1f(u(ptProg,'uPointOn'), pointOn ? 1.0 : 0.0);
  gl.uniform3f(u(ptProg,'uPointPos'), pointPos[0], pointPos[1], pointPos[2]);
  gl.uniform3f(u(ptProg,'uPointColor'), pointColor[0], pointColor[1], pointColor[2]);
  gl.uniform1f(u(ptProg,'uPointInt'), pointInt);
  gl.uniform1f(u(ptProg,'uFocus'), focusDist);
  gl.uniform1f(u(ptProg,'uAperture'), aperture);
  const sd = computeSunDir(sunAz, sunEl);
  gl.uniform3f(u(ptProg,'uSunDir'), sd[0], sd[1], sd[2]);
  gl.uniform1f(u(ptProg,'uSunInt'), sunInt);
  gl.uniform1f(u(ptProg,'uRough'), rough);
  gl.uniform1f(u(ptProg,'uJitter'), jitter);
  gl.uniform1f(u(ptProg,'uFog'), fogDensity);
  gl.uniform3f(u(ptProg,'uFogColor'), fogColor[0], fogColor[1], fogColor[2]);
  gl.uniform3f(u(ptProg,'uBgTop'), bgTop[0], bgTop[1], bgTop[2]);
  gl.uniform3f(u(ptProg,'uBgBottom'), bgBottom[0], bgBottom[1], bgBottom[2]);
  gl.uniform1f(u(ptProg,'uRR'), rrOn ? 1.0 : 0.0);
  gl.uniform1f(u(ptProg,'uNEE'), neeOn ? 1.0 : 0.0);
  gl.uniform1f(u(ptProg,'uTime'), now/1000);
  gl.bindVertexArray(quad);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if(autoExp && frame > 0 && frame % 20 === 0){          // 自动曝光：每隔 20 帧归一化一次
    const avg = readAvgLum();
    if(avg > 1e-4){
      exposure = Math.min(5.0, Math.max(0.1, 0.5 / avg));
      $('exp').value = exposure; $('expVal').textContent = exposure.toFixed(1);
    }
  }
  }

  // 显示 -> 屏幕
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.useProgram(showProg);
  const accumTex = (frame%2===0)? texB : texA;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accumTex); gl.uniform1i(u(showProg,'uAccum'), 0);
  gl.uniform1i(u(showProg,'uSamples'), frame+1);
  gl.uniform1f(u(showProg,'uExposure'), exposure);
  gl.uniform1i(u(showProg,'uTone'), toneMode);
  gl.uniform1i(u(showProg,'uDenoise'), denoiseOn ? 1 : 0);
  gl.uniform1i(u(showProg,'uDenIters'), denIters);
  gl.uniform2f(u(showProg,'uTexSize'), RW, RH);
  gl.uniform1i(u(showProg,'uBloom'), bloomOn ? 1 : 0);
  gl.uniform1f(u(showProg,'uBloomStr'), bloomStr);
  gl.uniform1f(u(showProg,'uBloomThr'), bloomThr);
  gl.uniform1i(u(showProg,'uVignette'), vignetteOn ? 1 : 0);
  gl.uniform1f(u(showProg,'uVigStr'), vigStr);
  gl.uniform1f(u(showProg,'uGamma'), gamma);
  gl.uniform1i(u(showProg,'uChroma'), chromaOn ? 1 : 0);
  gl.uniform1f(u(showProg,'uChromaStr'), chromaStr);
  gl.uniform1i(u(showProg,'uGrain'), grainOn ? 1 : 0);
  gl.uniform1f(u(showProg,'uGrainStr'), grainStr);
  gl.uniform1f(u(showProg,'uFrame'), frame);
  gl.uniform1f(u(showProg,'uSatStr'), satStr);
  gl.uniform1f(u(showProg,'uContrast'), contrast);
  gl.uniform1f(u(showProg,'uSharpen'), sharpen);
  gl.uniform1f(u(showProg,'uDither'), dither);
  gl.uniform1f(u(showProg,'uTemp'), temp);
  gl.uniform1f(u(showProg,'uHue'), hue);
  gl.uniform1f(u(showProg,'uSepia'), sepia);
  gl.uniform1f(u(showProg,'uPosterize'), posterize);
  gl.uniform1f(u(showProg,'uLetterbox'), letterbox);
  gl.uniform1f(u(showProg,'uScanline'), scanline);
  gl.uniform1f(u(showProg,'uInvert'), invert);
  gl.uniform1f(u(showProg,'uBorder'), border);
  gl.uniform1f(u(showProg,'uBright'), bright);
  gl.uniform1f(u(showProg,'uDuotone'), duotone);
  gl.uniform1f(u(showProg,'uVibrance'), vibrance);
  gl.uniform1f(u(showProg,'uMono'), mono);
  gl.uniform1f(u(showProg,'uTint'), tint);
  gl.uniform1f(u(showProg,'uBalance'), balance);
  gl.uniform1f(u(showProg,'uBleach'), bleach);
  gl.uniform1f(u(showProg,'uFade'), fade);
  gl.uniform1f(u(showProg,'uSplitTone'), splittone);
  gl.uniform1f(u(showProg,'uHighlights'), highlights);
  gl.uniform1f(u(showProg,'uGlow'), glow);
  gl.uniform1f(u(showProg,'uSolarize'), solarize);
  gl.uniform1f(u(showProg,'uExpose'), expose);
  gl.uniform1f(u(showProg,'uThreshold'), threshold);
  gl.uniform1f(u(showProg,'uCrossprocess'), crossprocess);
  gl.uniform1f(u(showProg,'uFalsecolor'), falsecolor);
  gl.uniform1f(u(showProg,'uGradientmap'), gradientmap);
  gl.uniform1f(u(showProg,'uPastel'), pastel);
  gl.uniform1f(u(showProg,'uInfrared'), infrared);
  gl.uniform1f(u(showProg,'uRadial'), radial);
  gl.uniform1f(u(showProg,'uSwirl'), swirl);
  gl.uniform1f(u(showProg,'uNight'), night);
  gl.uniform1f(u(showProg,'uEmboss'), emboss);
  gl.uniform1f(u(showProg,'uEdge'), edge);
  gl.uniform1f(u(showProg,'uPixelate'), pixelate);
  gl.uniform1f(u(showProg,'uRgbshift'), rgbshift);
  gl.uniform1f(u(showProg,'uTechni'), techni);
  gl.uniform1f(u(showProg,'uVhs'), vhs);
  gl.uniform1f(u(showProg,'uColorkey'), colorkey);
  gl.uniform1f(u(showProg,'uAnaglyph'), anaglyph);
  gl.uniform1f(u(showProg,'uHalftone'), halftone);
  gl.uniform1f(u(showProg,'uOil'), oil);
  gl.uniform1f(u(showProg,'uLomo'), lomo);
  gl.uniform1f(u(showProg,'uLeak'), leak);
  gl.uniform1f(u(showProg,'uWave'), wave);
  gl.uniform1f(u(showProg,'uCnoise'), cnoise);
  gl.uniform1f(u(showProg,'uKaleido'), kaleido);
  gl.uniform1f(u(showProg,'uRipple'), ripple);
  gl.uniform1f(u(showProg,'uHuequant'), huequant);
  gl.uniform1f(u(showProg,'uLift'), lift);
  gl.uniform1f(u(showProg,'uHsat'), hsat);
  gl.uniform1f(u(showProg,'uGlitch'), glitch);
  gl.uniform1f(u(showProg,'uCyanotype'), cyanotype);
  gl.uniform1f(u(showProg,'uSelenium'), selenium);
  gl.uniform1f(u(showProg,'uMoonlight'), moonlight);
  gl.uniform1f(u(showProg,'uVerdigris'), verdigris);
  gl.uniform1f(u(showProg,'uRosegold'), rosegold);
  gl.uniform1f(u(showProg,'uAurora'), aurora);
  gl.uniform1f(u(showProg,'uAmber'), amber);
  gl.uniform1f(u(showProg,'uWatercolor'), watercolor);
  gl.uniform1f(u(showProg,'uPixelSize'), pixelSize);
  gl.uniform1f(u(showProg,'uHueShift'), hueShift);
  gl.uniform3f(u(showProg,'uDuotoneShadow'), duotoneShadow[0], duotoneShadow[1], duotoneShadow[2]);
  gl.uniform3f(u(showProg,'uDuotoneHigh'), duotoneHigh[0], duotoneHigh[1], duotoneHigh[2]);
  gl.uniform1f(u(showProg,'uChromaAmt'), chromaAmt);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  frame++;
  $('spp').textContent = frame;
  $('fps').textContent = fpsSmooth.toFixed(0);
}
allocBuffers();
loop();
