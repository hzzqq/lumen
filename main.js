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
uniform float uTime;
uniform int   uFrame;       // 累积帧号（黄金比渐进采样用，逐帧变化）
uniform float uFocus;       // 对焦距离
uniform float uAperture;    // 光圈半径（0 = 关闭景深）
uniform vec3  uSunDir;      // 太阳方向（单位向量，由方位角/高度角计算，影响天空太阳盘与雾照明）
uniform float uSunInt;      // 太阳强度（0 = 无太阳盘/辉光，默认 1）
uniform float uRough;       // 金属粗糙度（0 = 镜面，1 = 宽瓣模糊反射，GGX 风格微面元近似）
uniform float uFog;         // 体积雾密度（0 = 关闭）
uniform float uRR;          // 俄罗斯轮盘提前终止（0 = 关闭）
uniform float uNEE;         // 直接光采样 NEE（0 = 关闭，回退纯路径追踪）
uniform float uJitter;      // 黄金比渐进采样强度(0=关闭, 1=像素内全幅抖动, 逐帧在像素内偏移主射线)

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
  vec3 zenith = vec3(0.20,0.36,0.66);
  vec3 horizon = vec3(0.62,0.70,0.80);
  vec3 ground = vec3(0.10,0.09,0.085);
  vec3 col;
  if(y>0.0) col = mix(horizon, zenith, pow(clamp(y,0.0,1.0),0.5));
  else col = mix(horizon, ground, pow(clamp(-y,0.0,1.0),0.4));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(22.0,18.0,13.0) * uSunInt * pow(s, 1500.0);   // 太阳盘（强度可调）
  col += vec3(0.8,0.7,0.55) * uSunInt * pow(s, 6.0);        // 太阳辉光（强度可调）
  return col * uEnv;
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

vec3 radiance(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0); vec3 thr = vec3(1.0);
  bool fromDiffuse = false;          // 上一 bounce 是否为漫反射（用于避免 NEE 与反弹双重计光）
  for(int b=0;b<uMaxBounces;b++){
    Hit h = scene(ro,rd);
    // 体积雾：按段长衰减贡献并叠加天空照亮的雾
    float seg = h.hit ? h.t : 1e9;
    if(uFog > 0.0001){
      float fogA = 1.0 - exp(-uFog * seg);
      vec3 fogCol = sky(rd) * uEnv;
      L += thr * fogCol * fogA;
      thr *= (1.0 - fogA);
      if(!h.hit){ break; }
    } else if(!h.hit){ L += thr*sky(rd); break; }
    // 命中面光源：NEE 已覆盖的有限球光源（场景 2/5/6）在漫反射 bounce 上跳过，避免重复计光；
    // 其余场景（如 Cornell 无限平面光）仍由反弹直接照亮，不跳过。
    if(h.mat==3){
      bool neeLit = (uScene==2 || uScene==5 || uScene==6);
      if(!fromDiffuse || !neeLit) L += thr*h.emission;
      break;
    }
    // 直接光采样（NEE）：漫反射命中点朝面光源采样，显著降低噪声
    if(uNEE > 0.5 && h.mat==0){ L += thr * neeDirect(h.p, h.n, h.albedo); }
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
  return L;
}

void main(){
  rngState = uint(gl_FragCoord.x)*1973u + uint(gl_FragCoord.y)*9277u + uint(uTime*60.0)*26699u + 1u;
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
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
uniform int   uGrain;      // 0 关闭 1 开启 胶片噪点(模拟胶片颗粒感)
uniform float uGrainStr;   // 噪点强度(0=无, ~0.15 明显颗粒)
uniform float uFrame;      // 累积帧号(供噪点逐帧变化)
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
vec3 tonemap(vec3 x, int m){
  if(m==1) return reinhard(x);
  if(m==2) return clamp(x, 0.0, 1.0);   // 线性(仅裁剪)
  if(m==3) return clamp(uncharted2(x), 0.0, 1.0);
  return aces(x);                        // 0 = ACES
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
void main(){
  vec3 c = sampleHDR(vUv);
  if(uDenoise == 1){ c = denoiseAtrus(c, vUv, uDenIters); }
  if(uBloom == 1){ c += bloom(vUv, uBloomThr) * uBloomStr; }   // 加性叠加泛光光晕
  if(uChroma == 1){                                          // 色差：R/B 通道沿径向偏移重采样(以 c.g 为基准)
    vec2 dir = vUv - 0.5;
    float amt = uChromaStr * 0.03;                         // 强度 1 时边缘最大偏移 3% 像素
    vec3 r = sampleHDR(vUv - dir * amt);
    vec3 b = sampleHDR(vUv + dir * amt);
    c = vec3(r.r, c.g, b.b);
  }
  c = tonemap(c * uExposure, uTone);
  c = pow(c, vec3(1.0 / uGamma));                       // 可调 gamma 显示校正
  if(uVignette == 1){ c *= vignette(vUv, uVigStr); }   // 暗角：边缘压暗
  if(uGrain == 1){                                          // 胶片噪点：叠加高频随机颗粒(在暗角之后, 最终合成)
    float n = (hash21(vUv * (uFrame + 1.0) * 60.0) - 0.5) * uGrainStr;
    c = clamp(c + vec3(n), 0.0, 1.0);
  }
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
let sceneId=0, maxBounces=6, resScale=1.0, paused=false, envInt=1.0, exposure=1.0, focusDist=9.0, aperture=0.0, sunAz=35.0, sunEl=40.0, sunInt=1.0, autoRotate=false, rotAccum=0, maxSamples=2000, toneMode=0, autoExp=false, fogDensity=0.0, rrOn=false, denoiseOn=false, denIters=3, neeOn=true, bloomOn=false, bloomStr=0.6, bloomThr=1.0, vignetteOn=false, vigStr=0.5, chromaOn=false, chromaStr=0.5, grainOn=false, grainStr=0.08, gamma=2.2, rough=0.0, jitter=1.0;
// ---------- 场景预设（相机 + 渲染参数）JSON 导入/导出 ----------
// 纯函数：不依赖 THREE，便于 Node 测试与复用。
function serializeScene(s){
  return {
    v: 1,
    sceneId: s.sceneId, theta: s.theta, phi: s.phi, radius: s.radius,
    target: Array.isArray(s.target) ? [s.target[0], s.target[1], s.target[2]] : [0,0,0],
    maxBounces: s.maxBounces, resScale: s.resScale, exposure: s.exposure,
    focusDist: s.focusDist, aperture: s.aperture, maxSamples: s.maxSamples,
    sunAz: s.sunAz, sunEl: s.sunEl, sunInt: s.sunInt, rough: s.rough, jitter: s.jitter,
    toneMode: s.toneMode, autoExp: s.autoExp, fogDensity: s.fogDensity, rrOn: s.rrOn,
    denoiseOn: s.denoiseOn, denIters: s.denIters, neeOn: s.neeOn, envInt: s.envInt,
    bloomOn: s.bloomOn, bloomStr: s.bloomStr, bloomThr: s.bloomThr, vignetteOn: s.vignetteOn, vigStr: s.vigStr,
    chromaOn: s.chromaOn, chromaStr: s.chromaStr,
    grainOn: s.grainOn, grainStr: s.grainStr,
    gamma: s.gamma
  };
}
function deserializeScene(d){
  d = d || {};
  const num = (k, def) => (typeof d[k] === 'number' && isFinite(d[k])) ? d[k] : def;
  const bool = (k, def) => (typeof d[k] === 'boolean') ? d[k] : def;
  const t = (Array.isArray(d.target) && d.target.length >= 3) ? [d.target[0], d.target[1], d.target[2]] : [0,0,0];
  return {
    sceneId: num('sceneId', 0), theta: num('theta', 0.6), phi: num('phi', 1.15), radius: num('radius', 9),
    target: t, maxBounces: num('maxBounces', 6), resScale: num('resScale', 1), exposure: num('exposure', 1),
    focusDist: num('focusDist', 9), aperture: num('aperture', 0), maxSamples: num('maxSamples', 2000),
    sunAz: num('sunAz', 35), sunEl: num('sunEl', 40), sunInt: num('sunInt', 1), rough: num('rough', 0), jitter: num('jitter', 1),
    toneMode: num('toneMode', 0), autoExp: bool('autoExp', false), fogDensity: num('fogDensity', 0), rrOn: bool('rrOn', false),
    denoiseOn: bool('denoiseOn', false), denIters: num('denIters', 3), neeOn: bool('neeOn', true), envInt: num('envInt', 1),
    bloomOn: bool('bloomOn', false), bloomStr: num('bloomStr', 0.6), bloomThr: num('bloomThr', 1.0),
    vignetteOn: bool('vignetteOn', false), vigStr: num('vigStr', 0.5),
    chromaOn: bool('chromaOn', false), chromaStr: num('chromaStr', 0.5),
    grainOn: bool('grainOn', false), grainStr: num('grainStr', 0.08),
    gamma: num('gamma', 2.2)
  };
}
let avgBuf=null;
const $ = id=>document.getElementById(id);
// 由方位角/高度角计算太阳单位方向向量（el 为地平线以上仰角；结果单位长度）
function computeSunDir(azDeg, elDeg){
  const az = azDeg * Math.PI/180, el = elDeg * Math.PI/180;
  const ce = Math.cos(el);
  return [ce*Math.sin(az), Math.sin(el), ce*Math.cos(az)];
}
// ---------- 场景预设画廊：命名化的「几何 + 相机 + 渲染参数」全套配置 ----------
const PRESETS = [
  { name:'经典展厅', sceneId:0, theta:0.6, phi:0.4, radius:11, target:[0,1.5,0], maxBounces:6, resScale:1, exposure:1.0, focusDist:9, aperture:0, maxSamples:2000, toneMode:0, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:true, envInt:1, bloomOn:false, bloomStr:0.6, bloomThr:1.0 },
  { name:'电影感夜景', sceneId:2, theta:0.9, phi:0.3, radius:9, target:[0,1,0], maxBounces:8, resScale:1, exposure:0.7, focusDist:6, aperture:0.02, maxSamples:3000, toneMode:3, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:4, neeOn:true, envInt:0.6, bloomOn:true, bloomStr:0.9, bloomThr:0.8 },
  { name:'极简高光', sceneId:1, theta:0.4, phi:0.5, radius:13, target:[0,0,0], maxBounces:4, resScale:1, exposure:1.4, focusDist:12, aperture:0, maxSamples:1500, toneMode:1, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:false, envInt:1.2, bloomOn:false, bloomStr:0.6, bloomThr:1.0 },
  { name:'玻璃特写', sceneId:6, theta:0.7, phi:0.35, radius:6, target:[0,0.5,0], maxBounces:12, resScale:1, exposure:1.0, focusDist:3.2, aperture:0.05, maxSamples:4000, toneMode:0, autoExp:false, fogDensity:0, rrOn:true, denoiseOn:true, denIters:3, neeOn:true, envInt:1, bloomOn:false, bloomStr:0.6, bloomThr:1.0 },
  { name:'行星远眺', sceneId:5, theta:1.1, phi:0.2, radius:16, target:[0,0,0], maxBounces:6, resScale:1, exposure:1.1, focusDist:14, aperture:0, maxSamples:2500, toneMode:2, autoExp:false, fogDensity:0, rrOn:false, denoiseOn:false, denIters:3, neeOn:true, envInt:1, bloomOn:true, bloomStr:0.5, bloomThr:0.9 }
];
// 纯函数：将预设对象归一化为完整参数（带类型守卫），供应用与测试复用
function presetToParams(p){
  const num = (v, d)=> (typeof v === 'number' && isFinite(v)) ? v : d;
  const bool = (v)=> v === true;
  const arr3 = (v)=> (Array.isArray(v) && v.length === 3) ? [Number(v[0]), Number(v[1]), Number(v[2])] : [0,0,0];
  return {
    sceneId: num(p.sceneId, 0)|0, theta: num(p.theta, 0), phi: num(p.phi, 0), radius: num(p.radius, 10),
    target: arr3(p.target), maxBounces: num(p.maxBounces, 6)|0, resScale: num(p.resScale, 1),
    exposure: num(p.exposure, 1), focusDist: num(p.focusDist, 9), aperture: num(p.aperture, 0),
    sunAz: num(p.sunAz, 35), sunEl: num(p.sunEl, 40), sunInt: num(p.sunInt, 1), rough: num(p.rough, 0), jitter: num(p.jitter, 1),
    maxSamples: num(p.maxSamples, 2000)|0, toneMode: num(p.toneMode, 0)|0, autoExp: bool(p.autoExp),
    fogDensity: num(p.fogDensity, 0), rrOn: bool(p.rrOn), denoiseOn: bool(p.denoiseOn), denIters: num(p.denIters, 3)|0,
    neeOn: bool(p.neeOn), envInt: num(p.envInt, 1), bloomOn: bool(p.bloomOn), bloomStr: num(p.bloomStr, 0.6), bloomThr: num(p.bloomThr, 1),
    vignetteOn: bool(p.vignetteOn), vigStr: num(p.vigStr, 0.5),
    gamma: num(p.gamma, 2.2)
  };
}
function applyPreset(idx){
  const p = PRESETS[idx]; if(!p) return;
  const s = presetToParams(p);
  sceneId=s.sceneId; theta=s.theta; phi=s.phi; radius=s.radius; target=s.target.slice();
  maxBounces=s.maxBounces; resScale=s.resScale; exposure=s.exposure; focusDist=s.focusDist; aperture=s.aperture;
  sunAz=s.sunAz; sunEl=s.sunEl; sunInt=s.sunInt; rough=s.rough; jitter=s.jitter;
  maxSamples=s.maxSamples; toneMode=s.toneMode; autoExp=s.autoExp; fogDensity=s.fogDensity; rrOn=s.rrOn;
  denoiseOn=s.denoiseOn; denIters=s.denIters; neeOn=s.neeOn; envInt=s.envInt; bloomOn=s.bloomOn; bloomStr=s.bloomStr; bloomThr=s.bloomThr;
  vignetteOn=s.vignetteOn; vigStr=s.vigStr; gamma=s.gamma;
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
    focusDist, aperture, maxSamples, sunAz, sunEl, sunInt, rough, jitter, toneMode, autoExp, fogDensity, rrOn, denoiseOn, denIters, neeOn, envInt, bloomOn, bloomStr, bloomThr, vignetteOn, vigStr, chromaOn, chromaStr, grainOn, grainStr, gamma });
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
      sunAz=s.sunAz; sunEl=s.sunEl; sunInt=s.sunInt; rough=s.rough; jitter=s.jitter;
      maxSamples=s.maxSamples; toneMode=s.toneMode; autoExp=s.autoExp; fogDensity=s.fogDensity; rrOn=s.rrOn;
      denoiseOn=s.denoiseOn; denIters=s.denIters; neeOn=s.neeOn; envInt=s.envInt; bloomOn=s.bloomOn; bloomStr=s.bloomStr; bloomThr=s.bloomThr;
      vignetteOn=s.vignetteOn; vigStr=s.vigStr; chromaOn=s.chromaOn; chromaStr=s.chromaStr; grainOn=s.grainOn; grainStr=s.grainStr; gamma=s.gamma;
      syncSceneUI(); clearAccum();
    }catch(err){ /* 解析失败静默忽略 */ }
  };
  r.readAsText(f); e.target.value = '';
};
$('tone').onchange = e=>{ toneMode = +e.target.value; };
$('preset').onchange = e=>{ applyPreset(+e.target.value); };
$('autoexp').onchange = e=>{ autoExp = e.target.checked; };
$('fog').oninput = e=>{ fogDensity = +e.target.value; $('fogVal').textContent = fogDensity.toFixed(2); clearAccum(); };
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
  gl.uniform1f(u(ptProg,'uEnv'), envInt);
  gl.uniform3fv(u(ptProg,'uCamPos'), cam.pos);
  gl.uniform3fv(u(ptProg,'uCamRight'), cam.right);
  gl.uniform3fv(u(ptProg,'uCamUp'), cam.up);
  gl.uniform3fv(u(ptProg,'uCamFwd'), cam.fwd);
  gl.uniform1f(u(ptProg,'uFov'), 50*Math.PI/180);
  gl.uniform1f(u(ptProg,'uFocus'), focusDist);
  gl.uniform1f(u(ptProg,'uAperture'), aperture);
  const sd = computeSunDir(sunAz, sunEl);
  gl.uniform3f(u(ptProg,'uSunDir'), sd[0], sd[1], sd[2]);
  gl.uniform1f(u(ptProg,'uSunInt'), sunInt);
  gl.uniform1f(u(ptProg,'uRough'), rough);
  gl.uniform1f(u(ptProg,'uJitter'), jitter);
  gl.uniform1f(u(ptProg,'uFog'), fogDensity);
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  frame++;
  $('spp').textContent = frame;
  $('fps').textContent = fpsSmooth.toFixed(0);
}
allocBuffers();
loop();
