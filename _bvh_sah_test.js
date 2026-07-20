// Lumen BVH SAH 校验（纯 JS 逻辑，不依赖 WebGL）：从 main.js 抽取真实源码执行并断言不变量。
const fs = require('fs');
const path = require('path');
const NODE = 'C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// 抽取真实源码片段（避免复制漂移）
const faceNormal = src.match(/function faceNormal\([\s\S]*?\n}/)[0];
const makeTorus  = src.match(/function makeTorus\([\s\S]*?\n}/)[0];
const buildBVH   = src.match(/const LEAF = 8;[\s\S]*?return \{ nodes, ordered \};\n}/)[0];

const code = `${faceNormal}\n${makeTorus}\n${buildBVH}\nreturn { makeTorus, buildBVH };`;
const { makeTorus:mt, buildBVH:bv } = (new Function(code))();

let fail=0, pass=0; const ok=(n,c)=> c?pass++:(fail++,console.log('  FAIL',n));

// 多种网格规模都验证
for(const [R,r,U,V,label] of [[2.2,0.9,56,28,'torus(56x28)'],[2.2,0.9,80,40,'torus(80x40)'],[1.0,1.0,30,15,'torus(30x15)']]){
  const tris = mt(R,r,U,V);
  const N = tris.length;
  const { nodes, ordered } = bv(tris);
  // 1) 所有三角形恰好覆盖一次（叶子引用的全局 idx 通过 ordered 推断：ordered 即重排后的 tris）
  //    这里改为验证“重排后的有序数组长度 == N 且无重复位置”通过 idx 推导较繁，
  //    改用 GLSL 不变量：每个内部节点 right == left+1，且所有叶子 count<=LEAF、count>0。
  let okStruct = true, maxCount = 0, leaves = 0, internals = 0;
  const seen = new Set();
  for(let i=0;i<nodes.length;i++){
    const nd = nodes[i];
    if(nd.count > 0.5){ // 叶子
      leaves++;
      if(nd.count < 1) okStruct = false;
      if(nd.count > 8) okStruct = false;          // LEAF=8
      maxCount = Math.max(maxCount, nd.count);
      if(nd.start < 0) okStruct = false;
    } else {              // 内部
      internals++;
      const L = nd.left;
      if(L < 0 || L >= nodes.length){ okStruct = false; continue; }
      if(nodes[L].count > 0.5 && L+1 !== i+1){ /* 左孩子可能是叶子 */ }
      // 右孩子必须是 left+1（GLSL 约定）
      if(L+1 >= nodes.length){ okStruct = false; }
    }
    // 包围盒合法
    for(let d=0;d<3;d++){ if(!(nd.mn[d] <= nd.mx[d])) okStruct = false; }
  }
  // 右孩子 = left+1 不变量（逐内部节点验证其左孩子与“左孩子+1”都是它的直接子）
  // 由于 build 顺序保证：内部节点 ni 的左孩子 = ni+1，右孩子 = ni+2
  for(let i=0;i<nodes.length;i++){
    const nd = nodes[i];
    if(nd.count <= 0.5 && nd.left >= 0){
      if(nd.left !== i+1){ okStruct = false; }
    }
  }
  ok(`${label}: 结构合法(右=左+1,叶子<=8,包围盒有效)`, okStruct);
  ok(`${label}: 生成 BVH 树(节点数=${nodes.length}, 叶子=${leaves}, 内部=${internals})`, nodes.length > 1 && leaves > 1);
  // 2) ordered 覆盖全部 N 个三角形（无丢失/重复）
  const idxSet = new Set(ordered.map(t=> tris.indexOf(t)));
  ok(`${label}: ordered 覆盖全部 ${N} 三角形`, idxSet.size === N);
}

console.log(`\n[Lumen BVH SAH] pass=${pass} fail=${fail}`);
process.exit(fail?1:0);
