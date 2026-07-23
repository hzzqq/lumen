// _tone5_test.js — ci337 五色调后处理批次：月光 Moonlight / 铜绿 Verdigris / 玫瑰金 Rose Gold / 极光 Aurora / 琥珀 Amber
// 校验十二步接线全链路 + presetToParams 字段数 102
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; } else { fail++; console.error('  FAIL: ' + name); } }

const EFFECTS = [
  { key: 'moonlight', uni: 'uMoonlight' },
  { key: 'verdigris', uni: 'uVerdigris' },
  { key: 'rosegold',  uni: 'uRosegold'  },
  { key: 'aurora',    uni: 'uAurora'    },
  { key: 'amber',     uni: 'uAmber'     },
];

for(const { key, uni } of EFFECTS){
  // ① uniform 声明
  ok(`uniform 声明 ${uni}`, new RegExp(`uniform float ${uni};`).test(main));
  // ② GLSL 分支
  ok(`GLSL 分支 if(${uni} > 0.0)`, main.includes(`if(${uni} > 0.0)`));
  ok(`GLSL 以 mix(..., ${uni}) 收尾`, new RegExp(`mix\\(c, \\w+, ${uni}\\);`).test(main));
  // ③ state 默认
  ok(`state 默认 ${key}=0`, new RegExp(`${key}=0[,;]`).test(main));
  // ④ serialize
  ok(`serializeScene 含 ${key}`, main.includes(`${key}: s.${key}`));
  // ⑤ deserialize
  ok(`deserializeScene 含 ${key}`, main.includes(`${key}: num('${key}', 0)`));
  // ⑥ presetToParams
  ok(`presetToParams 含 ${key}`, main.includes(`${key}: num(p.${key}, 0)`));
  // ⑦ 赋值链（applyPreset + importScene 两处）
  ok(`赋值链 ${key}=s.${key} ×2`, (main.match(new RegExp(`${key}=s\\.${key};`, 'g')) || []).length >= 2);
  // ⑧ UI 恢复
  ok(`syncSceneUI 恢复 ${key} 滑块`, new RegExp(`\\$\\('${key}'\\)\\.value = Math\\.round\\(${key} \\* 100\\)`).test(main));
  // ⑨ oninput
  ok(`oninput 接线 ${key}`, new RegExp(`\\$\\('${key}'\\)\\.oninput`).test(main));
  // ⑩ uniform 绑定
  ok(`uniform 绑定 ${uni}`, main.includes(`u(showProg,'${uni}'), ${key})`));
  // ⑪ exportScene 快照列表
  ok(`exportScene 快照含 ${key}`, new RegExp(`serializeScene\\(\\{[\\s\\S]*?\\b${key}\\b[\\s\\S]*?\\}\\)`).test(main.slice(main.indexOf("$('exportScene')"))));
  // ⑫ index.html 滑块
  ok(`index.html 含 ${key} 滑块`, html.includes(`id="${key}"`) && html.includes(`id="${key}Val"`));
}

// presetToParams 实际执行返回 102 字段，5 个新效果默认 0 / 透传
{
  const m = main.match(/function presetToParams\(p\)\{[\s\S]*?\n\}/);
  const f = eval('(' + m[0] + ')');
  const s = f({});
  ok('presetToParams 返回 102 字段', Object.keys(s).length === 102);
  for(const { key } of EFFECTS) ok(`空预设 ${key} 默认 0`, s[key] === 0);
  const s2 = f({ moonlight: 0.4, verdigris: 0.5, rosegold: 0.6, aurora: 0.7, amber: 0.8 });
  ok('moonlight 透传 0.4', s2.moonlight === 0.4);
  ok('verdigris 透传 0.5', s2.verdigris === 0.5);
  ok('rosegold 透传 0.6', s2.rosegold === 0.6);
  ok('aurora 透传 0.7', s2.aurora === 0.7);
  ok('amber 透传 0.8', s2.amber === 0.8);
}

console.log(`\n[Lumen tone5] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
