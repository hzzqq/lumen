// 忠实移植 main.js 的 uVibrance GLSL 分支为纯函数，便于无 WebGL 环境测试。
// GLSL: l=dot(c,(.299,.587,.114)); sat=max-min; boost=1+uVibrance*(1-sat); c=clamp(vec3(l)+(c-vec3(l))*boost,0,1)
function applyVibrance(c, v){
  const l = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const sat = mx - mn;
  const boost = 1 + v*(1 - sat);
  return [l + (c[0]-l)*boost, l + (c[1]-l)*boost, l + (c[2]-l)*boost].map(x=>Math.max(0, Math.min(1, x)));
}
function eq3(a, b){
  return a.length===3 && a.every((x,i)=> Math.abs(x-b[i]) < 1e-6);
}
let pass=0, fail=0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.log('  FAIL:', name); } }

ok('v=0 不变 [0.2,0.5,0.8]', eq3(applyVibrance([0.2,0.5,0.8],0), [0.2,0.5,0.8]));
ok('v=0 不变 [0,0.5,1]', eq3(applyVibrance([0,0.5,1],0), [0,0.5,1]));
ok('灰阶 v=1 仍灰 [0.5,0.5,0.5]', eq3(applyVibrance([0.5,0.5,0.5],1), [0.5,0.5,0.5]));
ok('低饱和 v=1 提拉 [0.4,0.5,0.6]', eq3(applyVibrance([0.4,0.5,0.6],1), [0.3348,0.5148,0.6948]));
ok('低饱和提拉后范围扩大(0.36>0.2)', (()=>{ const c=applyVibrance([0.4,0.5,0.6],1); return (Math.max(...c)-Math.min(...c)) > 0.2; })());
ok('高饱和 v=1 几乎不变 [0,0.5,1]', eq3(applyVibrance([0,0.5,1],1), [0,0.5,1]));
ok('v=0.5 半提拉 [0.4,0.5,0.6]', eq3(applyVibrance([0.4,0.5,0.6],0.5), [0.3674,0.5074,0.6474]));
ok('v=1 下限钳制 [0.0,0.02,0.05]', eq3(applyVibrance([0.0,0.02,0.05],1), [0.0,0.022432,0.080932]));
ok('v=1 上限钳制 [0.95,0.97,1.0]', eq3(applyVibrance([0.95,0.97,1.0],1), [0.933432,0.972432,1.0]));
ok('纯红 v=1 不变 [1,0,0]', eq3(applyVibrance([1,0,0],1), [1,0,0]));
ok('boost 公式独立验证 [0.4,0.5,0.6] v=1 => boost=1.8', Math.abs((1+1*(1-(0.6-0.4))) - 1.8) < 1e-9);

console.log(`vibrance: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
