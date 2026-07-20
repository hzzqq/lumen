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
uniform float uFocus;       // 对焦距离
uniform float uAperture;    // 光圈半径（0 = 关闭景深）
uniform float uFog;         // 体积雾密度（0 = 关闭）
uniform float uRR;          // 俄罗斯轮盘提前终止（0 = 关闭）

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
  vec3 sunDir = normalize(vec3(0.55,0.72,-0.42));
  float s = max(dot(d,sunDir),0.0);
  col += vec3(22.0,18.0,13.0) * pow(s, 1500.0);   // 太阳盘
  col += vec3(0.8,0.7,0.55) * pow(s, 6.0);        // 太阳辉光
  return col * uEnv;
}

vec3 radiance(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0); vec3 thr = vec3(1.0);
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
    if(h.mat==3){ L += thr*h.emission; break; }
    thr *= h.albedo;
    // 俄罗斯轮盘：深度足够后按吞吐概率提前终止低贡献路径（同等开销采样更多路径 → 效率提升）
    if(uRR > 0.5 && b > 3){
      float q = 1.0 - clamp(max(thr.r, max(thr.g, thr.b)), 0.0, 1.0);
      if(rnd() < q) break;
      thr /= max(1.0 - q, 1e-3);
    }
    if(h.mat==1){
      vec3 r = reflect(rd,h.n);
      rd = normalize(r + 0.04*randUnit());
      ro = h.p + h.n*EPS;
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
    } else {
      vec3 up = abs(h.n.z)<0.999? vec3(0,0,1):vec3(1,0,0);
      vec3 t = normalize(cross(up,h.n));
      vec3 b = cross(h.n,t);
      float r1=rnd(), r2=rnd();
      float ph=6.2831853*r1, r=sqrt(r2);
      vec3 dir = normalize(t*(r*cos(ph)) + b*(r*sin(ph)) + h.n*sqrt(max(0.0,1.0-r2)));
      rd = dir; ro = h.p + h.n*EPS;
    }
  }
  return L;
}

void main(){
  rngState = uint(gl_FragCoord.x)*1973u + uint(gl_FragCoord.y)*9277u + uint(uTime*60.0)*26699u + 1u;
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
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
uniform int uSamples;
uniform float uExposure;
uniform int uTone;
vec3 aces(vec3 x){
  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
vec3 reinhard(vec3 x){ return x/(1.0+x); }
vec3 tonemap(vec3 x, int m){
  if(m==1) return reinhard(x);
  if(m==2) return clamp(x, 0.0, 1.0);   // 线性(仅裁剪)
  return aces(x);                        // 0 = ACES
}
void main(){
  vec3 c = texture(uAccum, vUv).rgb / float(max(uSamples,1));
  c = tonemap(c * uExposure, uTone);
  c = pow(c, vec3(1.0/2.2));
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
function buildBVH(tris){
  const N = tris.length;
  const idx = new Array(N); for(let i=0;i<N;i++) idx[i]=i;
  const nodes = [];
  const aabb = t=>{
    const mn=[Math.min(t.v0[0],t.v1[0],t.v2[0]),Math.min(t.v0[1],t.v1[1],t.v2[1]),Math.min(t.v0[2],t.v1[2],t.v2[2])];
    const mx=[Math.max(t.v0[0],t.v1[0],t.v2[0]),Math.max(t.v0[1],t.v1[1],t.v2[1]),Math.max(t.v0[2],t.v1[2],t.v2[2])];
    return {mn,mx};
  };
  const cen = t=>[ (t.v0[0]+t.v1[0]+t.v2[0])/3, (t.v0[1]+t.v1[1]+t.v2[1])/3, (t.v0[2]+t.v1[2]+t.v2[2])/3 ];
  function build(start, end){
    const ni = nodes.length;
    nodes.push({mn:[1e30,1e30,1e30],mx:[-1e30,-1e30,-1e30],left:-1,start:-1,count:-1});
    let c0=[1e30,1e30,1e30], c1=[-1e30,-1e30,-1e30];
    for(let i=start;i<end;i++){
      const k=idx[i], a=aabb(tris[k]);
      for(let d=0;d<3;d++){ if(a.mn[d]<nodes[ni].mn[d]) nodes[ni].mn[d]=a.mn[d]; if(a.mx[d]>nodes[ni].mx[d]) nodes[ni].mx[d]=a.mx[d]; }
      const c=cen(tris[k]);
      for(let d=0;d<3;d++){ if(c[d]<c0[d]) c0[d]=c[d]; if(c[d]>c1[d]) c1[d]=c[d]; }
    }
    const count = end-start;
    if(count<=LEAF){ nodes[ni].start=start; nodes[ni].count=count; return ni; }
    let axis=0, ext=c1[0]-c0[0];
    if(c1[1]-c0[1]>ext){axis=1;ext=c1[1]-c0[1];}
    if(c1[2]-c0[2]>ext){axis=2;ext=c1[2]-c0[2];}
    const mid=(c0[axis]+c1[axis])*0.5;
    let i=start, j=end-1;
    while(i<=j){
      const ck=cen(tris[idx[i]])[axis];
      if(ck<mid){ i++; } else { const tmp=idx[i]; idx[i]=idx[j]; idx[j]=tmp; j--; }
    }
    if(i===start || i===end) i=(start+end)>>1;
    const left=build(start,i); build(i,end);
    nodes[ni].left=left;
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

// 生成网格 + BVH 并上传
const torus = makeTorus(2.2, 0.9, 56, 28);   // 约 3136 个三角形
const bvh = buildBVH(torus);
const meshTex = packAndUpload(bvh.ordered);
const HAS_MESH = 1;
console.log('[Lumen] 网格三角形数 =', meshTex.triCount, ' BVH 节点数 =', bvh.nodes.length);

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
let sceneId=0, maxBounces=6, resScale=1.0, paused=false, envInt=1.0, exposure=1.0, focusDist=9.0, aperture=0.0, autoRotate=false, rotAccum=0, maxSamples=2000, toneMode=0, autoExp=false, fogDensity=0.0, rrOn=false;
let avgBuf=null;
const $ = id=>document.getElementById(id);
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
$('tone').onchange = e=>{ toneMode = +e.target.value; };
$('autoexp').onchange = e=>{ autoExp = e.target.checked; };
$('fog').oninput = e=>{ fogDensity = +e.target.value; $('fogVal').textContent = fogDensity.toFixed(2); clearAccum(); };
$('rr').onchange = e=>{ rrOn = e.target.checked; clearAccum(); };
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
  gl.uniform1f(u(ptProg,'uFog'), fogDensity);
  gl.uniform1f(u(ptProg,'uRR'), rrOn ? 1.0 : 0.0);
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  frame++;
  $('spp').textContent = frame;
  $('fps').textContent = fpsSmooth.toFixed(0);
}
allocBuffers();
loop();
