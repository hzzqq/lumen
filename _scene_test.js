// Lumen 场景预设测试：抽取真实 serializeScene/deserializeScene（纯函数，不依赖 THREE），验证往返保真。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
function extract(name){
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n');
  const m = src.match(re);
  if(!m) throw new Error('无法抽取函数 ' + name);
  return m[0];
}
const code = extract('serializeScene') + '\n' + extract('deserializeScene') + '\nreturn { serializeScene, deserializeScene };';
const { serializeScene, deserializeScene } = new Function(code)();

let pass = 0, fail = 0;
function ok(name, cond){ if(cond) pass++; else { fail++; console.log('  FAIL', name); } }

const state = {
  sceneId: 5, theta: 1.23, phi: 0.9, radius: 12.5, target: [1, 2, 3],
  maxBounces: 8, resScale: 0.75, exposure: 1.4, focusDist: 4.0, aperture: 0.05,
  maxSamples: 3000, toneMode: 2, autoExp: true, fogDensity: 0.08, rrOn: true,
  denoiseOn: true, denIters: 4, neeOn: false, envInt: 1.5, bloomOn: true, bloomStr: 0.7, bloomThr: 2.5
};

const data = serializeScene(state);
ok('序列化含版本号', data.v === 1);
ok('序列化是纯 JSON', JSON.stringify(data) === JSON.stringify(JSON.parse(JSON.stringify(data))));
ok('序列化含 target 数组', Array.isArray(data.target) && data.target[0] === 1 && data.target[2] === 3);
ok('序列化 bloom 值保留', data.bloomStr === 0.7 && data.bloomThr === 2.5);

// 往返保真
const s = deserializeScene(data);
ok('sceneId 往返', s.sceneId === 5);
ok('theta/phi/radius 往返', s.theta === 1.23 && s.phi === 0.9 && s.radius === 12.5);
ok('target 往返', s.target[0] === 1 && s.target[1] === 2 && s.target[2] === 3);
ok('exposure/maxBounces 往返', s.exposure === 1.4 && s.maxBounces === 8);
ok('bloom 往返', s.bloomOn === true && s.bloomStr === 0.7 && s.bloomThr === 2.5);
ok('bool 字段往返', s.autoExp === true && s.rrOn === true && s.denoiseOn === true && s.neeOn === false);
ok('往返返回独立对象（不污染入参）', s !== state);

// 默认与部分输入
const def = deserializeScene(undefined);
ok('undefined → 默认值', def.sceneId === 0 && def.radius === 9 && def.bloomOn === false && def.bloomStr === 0.6);
const part = deserializeScene({ sceneId: 3, theta: 2.0 });
ok('部分字段 → 指定字段用输入、其余默认', part.sceneId === 3 && part.theta === 2.0 && part.phi === 1.15 && part.bloomThr === 1.0);
const badNum = deserializeScene({ radius: 'oops', sceneId: 2 });
ok('非数字半径 → 默认', badNum.radius === 9 && badNum.sceneId === 2);

console.log(`\n[Lumen scene-preset] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
