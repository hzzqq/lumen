// Lumen ci56 — 模型导入(OBJ/glTF) 解析参考测试
// 从 main.js 抽取真实的 parseOBJ + faceNormal 并断言三角化行为。
// glTF 解析依赖浏览器 atob/FileReader，仅做语法层(node --check)覆盖；此处验证可纯 Node 运行的 OBJ 路径。

const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

// 括号配平地抽取一个 function 定义（支持嵌套 {}）
function extract(src, name){
  const start = src.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('未找到 ' + name);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for(let j=i; j<src.length; j++){
    if(src[j] === '{') depth++;
    else if(src[j] === '}'){ depth--; if(depth === 0){ end = j+1; break; } }
  }
  return src.slice(start, end);
}

const faceNormal = eval('(' + extract(main, 'faceNormal') + ')');
const parseOBJ   = eval('(' + extract(main, 'parseOBJ') + ')');

let pass=0, fail=0;
function ok(name, cond){ if(cond){ pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }

console.log('ci56 模型导入(OBJ)测试');

// 单元三角形
(()=>{
  const tris = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  ok('单三角形 → 1 个三角面', tris.length === 1);
  const t = tris[0];
  ok('顶点 1 = (0,0,0)', t.v0[0]===0 && t.v0[1]===0 && t.v0[2]===0);
  ok('顶点 2 = (1,0,0)', t.v1[0]===1 && t.v1[1]===0 && t.v1[2]===0);
  ok('顶点 3 = (0,1,0)', t.v2[0]===0 && t.v2[1]===1 && t.v2[2]===0);
  ok('面法线已计算(z 朝向 +)', Math.abs(t.n[2] - 1) < 1e-9);
  ok('默认漫反射材质 mat=0', t.mat === 0);
})();

// 四边形 → 三角扇化 2 个三角面
(()=>{
  const tris = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  ok('四边形扇形 → 2 个三角面', tris.length === 2);
  ok('第二三角面含顶点3(1,1,0)', tris[1].v1[0]===1 && tris[1].v1[1]===1);
})();

// 带 /vt /vn 记法的面（只取顶点索引）
(()=>{
  const tris = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\n');
  ok('v/vt/vn 记法解析为 1 三角面', tris.length === 1);
  ok('顶点索引正确(1,2,3)', tris[0].v1[0]===1 && tris[0].v2[1]===1);
})();

// 忽略注释与空行
(()=>{
  const tris = parseOBJ('# comment\n\nv 0 0 0\nv 1 0 0\nv 0 1 0\n\nf 1 2 3\n');
  ok('注释/空行被忽略 → 仍 1 三角面', tris.length === 1);
})();

// 负坐标
(()=>{
  const tris = parseOBJ('v -1 -1 -1\nv 1 -1 -1\nv 0 1 -1\nf 1 2 3\n');
  ok('负坐标被保留', tris[0].v0[0] === -1 && tris[0].v2[2] === -1);
})();

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
