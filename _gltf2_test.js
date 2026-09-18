// Lumen glTF 2.0 健壮版解析测试：从 main.js 抽取真实 parseGLTF + faceNormal 在 Node 下实跑。
// 覆盖：紧凑布局回归（Uint32/16/8 索引、无索引）、byteStride 交错布局、accessor 共享 bufferView 偏移、
// TRIANGLES/STRIP/FAN 三拓扑（含无索引变体）、点线拓扑跳过、多 mesh/primitive 合并、
// 六类错误语义（外部 buffer / POSITION 非 FLOAT VEC3 / 浮点索引 / 越界 / 缺 accessor / 坏 type）。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const NODE = process.execPath;
const dir = __dirname;
let pass = 0, fail = 0;
const ok = (n, c)=>{ if(c) pass++; else { fail++; console.log('  FAIL', n); } };
const near = (a, b)=> Math.abs(a - b) < 1e-6;

// 0) main.js 语法检查
try { execSync(`"${NODE}" --check --input-type=module < "${path.join(dir, 'main.js')}"`, { stdio:'pipe' }); ok('main.js 语法 OK', true); }
catch(e){ ok('main.js 语法 OK', false); console.log((e.stderr?e.stderr.toString():e.message).slice(0, 500)); }

const src = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
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
ok('modelFile 入口仍走 parseGLTF', src.includes("name.endsWith('.gltf') ? parseGLTF(JSON.parse(text))"));

let parseGLTF;
try {
  const bake = new Function('atob',
    extractFn('faceNormal') + '\n' + extractFn('parseGLTF') + '\nreturn parseGLTF;');
  parseGLTF = bake(s => Buffer.from(s, 'base64').toString('binary'));
  ok('parseGLTF 抽取成功', true);
} catch(e){ ok('parseGLTF 抽取成功', false); console.log('  ', e.message); }

// fixture 辅助：字节 → data URI；建最小 glTF
const b64uri = bytes => 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64');
const f32 = arr => { const b = new Float32Array(arr); return [...new Uint8Array(b.buffer)]; };
const u32 = arr => [...new Uint32Array(arr)].flatMap(v => [v&255, (v>>8)&255, (v>>16)&255, (v>>>24)&255]);
const u16 = arr => [...new Uint16Array(arr)].flatMap(v => [v&255, (v>>8)&255]);
const ACC_POS = (view, count, extra={}) => Object.assign({ bufferView:view, componentType:5126, count, type:'VEC3' }, extra);

if(parseGLTF){
  // ---- ① 紧凑布局回归（旧最简版行为）----
  // 四顶点两三角，Uint32 索引 [0,1,2, 2,1,3]
  const g1 = {
    buffers:[{ uri: b64uri([...f32([0,0,0, 1,0,0, 0,1,0, 0,0,1]), ...u32([0,1,2, 2,1,3])]) }],
    bufferViews:[{ buffer:0, byteOffset:0, byteLength:48+16 }],
    accessors:[ ACC_POS(0,4), { bufferView:0, componentType:5125, count:6, type:'SCALAR', byteOffset:48 } ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 }, indices:1 }] }],
  };
  const t1 = parseGLTF(g1);
  ok('Uint32 索引两三角', t1.length === 2);
  ok('顶点值保真', t1[0].v1[0] === 1 && t1[1].v2[2] === 1 && t1[0].v0[0] === 0);
  ok('面法线已算(xz 面第一三角 n≈±y/z)', Array.isArray(t1[0].n) && t1[0].n.length === 3);
  ok('默认漫反射材质', t1[0].mat === 0 && t1[0].albedo[0] === 0.82);
  // Uint16 索引
  const g2 = { buffers:[{ uri: b64uri([...f32([0,0,0, 1,0,0, 0,1,0]), ...u16([0,1,2])]) }],
    bufferViews:[{ buffer:0, byteLength:36+6 }],
    accessors:[ ACC_POS(0,3), { bufferView:0, componentType:5123, count:3, type:'SCALAR', byteOffset:36 } ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 }, indices:1 }] }] };
  ok('Uint16 索引单三角', parseGLTF(g2).length === 1);
  // Uint8 索引
  const g3 = { buffers:[{ uri: b64uri([...f32([0,0,0, 1,0,0, 0,1,0]), 0,1,2]) }],
    bufferViews:[{ buffer:0, byteLength:39 }],
    accessors:[ ACC_POS(0,3), { bufferView:0, componentType:5121, count:3, type:'SCALAR', byteOffset:36 } ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 }, indices:1 }] }] };
  ok('Uint8 索引单三角', parseGLTF(g3).length === 1);
  // 无索引：6 浮点顺排 → 2 三角
  const g4 = { buffers:[{ uri: b64uri(f32([0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, 0,0,1])) }],
    bufferViews:[{ buffer:0, byteLength:72 }],
    accessors:[ ACC_POS(0,6) ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] }] };
  ok('无索引连续三顶点成面', parseGLTF(g4).length === 2);

  // ---- ② 交错布局 byteStride（旧版会读错）----
  // 每 16 字节一个顶点：pos(12B) + pad(4B)，pad 填毒值 0x7F 验证不串位
  const P = [[0,0,0],[2,0,0],[0,2,0]], interleaved = [];
  for(const p of P){ interleaved.push(...f32(p), 0x7F, 0x7F, 0x7F, 0x7F); }
  const g5 = { buffers:[{ uri: b64uri(interleaved) }],
    bufferViews:[{ buffer:0, byteLength:48, byteStride:16 }],
    accessors:[ ACC_POS(0,3) ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] }] };
  const t5 = parseGLTF(g5);
  ok('交错布局按 stride 取数', t5.length === 1 && t5[0].v1[0] === 2 && t5[0].v2[1] === 2);
  ok('毒值填充未污染坐标', t5[0].v0[0] === 0 && t5[0].v1[1] === 0);

  // ---- ③ 共享 bufferView + accessor.byteOffset ----
  // 一块 bufferView 装两个 VEC3：accessor0 @0 字节，accessor1 @36 字节（跳过前 3 个顶点）
  const g6 = { buffers:[{ uri: b64uri(f32([0,0,0, 1,0,0, 0,1,0, 5,0,0, 6,0,0, 5,1,0])) }],
    bufferViews:[{ buffer:0, byteLength:72 }],
    accessors:[ ACC_POS(0,3), ACC_POS(0,3, { byteOffset:36 }) ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] },
            { primitives:[{ attributes:{ POSITION:1 } }] }] };
  const t6 = parseGLTF(g6);
  ok('双 mesh/primitive 合并', t6.length === 2);
  ok('accessor.byteOffset 生效', t6[1].v0[0] === 5 && t6[1].v1[0] === 6 && t6[1].v2[1] === 1);

  // ---- ④ 拓扑 mode ----
  const mk = (mode, idx) => ({
    buffers:[{ uri: b64uri([...f32([0,0,0, 1,0,0, 0,1,0, 0,0,1]), ...(idx ? u32(idx) : [])]) }],
    bufferViews:[{ buffer:0, byteLength: idx ? 64 : 48 }],
    accessors:[ ACC_POS(0,4), ...(idx ? [{ bufferView:0, componentType:5125, count:idx.length, type:'SCALAR', byteOffset:48 }] : []) ],
    meshes:[{ primitives:[ idx ? { attributes:{ POSITION:0 }, indices:1, mode } : { attributes:{ POSITION:0 }, mode }] }],
  });
  ok('mode 缺省 = TRIANGLES', parseGLTF(mk(undefined, [0,1,2])).length === 1);
  ok('TRIANGLE_STRIP 4 索引 → 2 三角', parseGLTF(mk(5, [0,1,2,3])).length === 2);
  ok('TRIANGLE_FAN 4 索引 → 扇形两三角', (()=>{ const t = parseGLTF(mk(6, [0,1,2,3])); return t.length===2 && t[1].v0[0]===0 && t[1].v1[1]===1 && t[1].v2[2]===1; })());
  ok('STRIP 无索引 4 顶点 → 2 三角', parseGLTF(mk(5, null)).length === 2);
  ok('FAN 无索引 → 2 三角', parseGLTF(mk(6, null)).length === 2);
  ok('点/线 mode(1) 跳过不产出', parseGLTF(mk(1, [0,1,2])).length === 0);

  // ---- ⑤ 错误语义（中文报错，坏文件不再静默产垃圾）----
  const raises = (g, word)=>{
    try { parseGLTF(g); return false; } catch(e){ return e.message.indexOf(word) >= 0; }
  };
  ok('外部 buffer(.bin) 明确报错', raises({ buffers:[{ uri:'scene.bin' }], bufferViews:[], accessors:[], meshes:[] }, '外部 buffer'));
  ok('POSITION 非 VEC3 报错', raises({ buffers:[{ uri: b64uri(f32([0,0])) }], bufferViews:[{ buffer:0, byteLength:8 }],
    accessors:[{ bufferView:0, componentType:5126, count:1, type:'VEC2' }],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] }] }, 'POSITION'));
  ok('浮点索引报错', raises({ buffers:[{ uri: b64uri([...f32([0,0,0, 1,0,0, 0,1,0]), ...f32([0,1,2])]) }],
    bufferViews:[{ buffer:0, byteLength:48 }],
    accessors:[ ACC_POS(0,3), { bufferView:0, componentType:5126, count:3, type:'SCALAR', byteOffset:36 } ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 }, indices:1 }] }] }, 'indices'));
  ok('accessor 越界报错', raises({ buffers:[{ uri: b64uri(f32([0,0,0, 1,0,0, 0,1,0])) }],
    bufferViews:[{ buffer:0, byteLength:36 }],
    accessors:[ ACC_POS(0, 99) ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 } }] }] }, '越界'));
  ok('POSITION 引用缺失 accessor 报错', raises({ buffers:[{ uri: b64uri(f32([0,0,0])) }],
    bufferViews:[{ buffer:0, byteLength:12 }], accessors:[],
    meshes:[{ primitives:[{ attributes:{ POSITION:7 } }] }] }, 'POSITION'));
  ok('indices 引用缺失 accessor 报错', raises({ buffers:[{ uri: b64uri(f32([0,0,0, 1,0,0, 0,1,0])) }],
    bufferViews:[{ buffer:0, byteLength:36 }],
    accessors:[ ACC_POS(0,3) ],
    meshes:[{ primitives:[{ attributes:{ POSITION:0 }, indices:9 }] }] }, 'indices'));
}

console.log(`[Lumen gltf2] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
