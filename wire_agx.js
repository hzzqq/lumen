// ci305 AgX 色调映射(toneMode=4)：新能力(新增色调模式) + R2(tonemap 末尾防御性 NaN/inf 钳制)
const fs = require('fs');
let s = fs.readFileSync('main.js', 'utf8');
function add(anchor, text, what){
  const i = s.indexOf(anchor);
  if (i < 0) throw new Error('anchor not found: ' + what);
  if (s.indexOf(anchor + text) >= 0) { console.log('skip(dup): ' + what); return; }
  if (s.indexOf(anchor, i + 1) >= 0) throw new Error('anchor not unique: ' + what);
  s = s.slice(0, i + anchor.length) + text + s.slice(i + anchor.length);
}

const agxFn = `
vec3 agxTonemap(vec3 x){                                     // AgX 风格紧凑曲线：对数压缩 + S 形对比 + 轻微去饱和
  x = max(x, 0.0);
  vec3 l = log2(1.0 + x * 16.0) / log2(17.0);                // 0..1 对数压缩
  vec3 sm = l * l * (3.0 - 2.0 * l);                         // 平滑 S 曲线(提升对比)
  float g = dot(sm, vec3(0.299, 0.587, 0.114));
  sm = mix(vec3(g), sm, 0.92);                               // 轻微去饱和(电影感)
  return clamp(sm, 0.0, 1.0);
}
`;

// ① 在 tonemap 之前插入 agxTonemap 函数
add('vec3 tonemap(vec3 x, int m){', agxFn + '\nvec3 tonemap(vec3 x, int m){', 'agx-fn');
// ② tonemap 内部加 mode 4 分支 + R2 防御性钳制末尾
add('  return aces(x);                        // 0 = ACES',
   '  if(m==4) return clamp(agxTonemap(x), 0.0, 1.0);   // 4 = AgX(电影感紧凑曲线)\n  return clamp(aces(x), 0.0, 1.0);                  // 0 = ACES（R2: 防御性 NaN/inf 钳制）',
   'agx-branch');

fs.writeFileSync('main.js', s);

// ③ index.html tone 下拉加 AgX 选项
let h = fs.readFileSync('index.html', 'utf8');
const opt = '        <option value="3">Uncharted2 (电影级)</option>';
if (h.indexOf(opt) < 0) throw new Error('tone option anchor not found');
if (h.indexOf('<option value="4">AgX') < 0) {
  h = h.replace(opt, opt + '\n        <option value="4">AgX 电影感</option>');
  fs.writeFileSync('index.html', h);
  console.log('agx option added');
} else { console.log('agx option already present'); }

console.log('OK agx wired');
