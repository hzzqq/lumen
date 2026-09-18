// Lumen — HDRI(Radiance .hdr) 解码测试
// 从 main.js 抽取真实的 parseHDR + hdrDecodeChan，断言 RGBE 展开与 RLE 扫描线解码行为。

const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

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

const hdrDecodeChan = eval('(' + extract(main, 'hdrDecodeChan') + ')');
const parseHDR      = eval('(' + extract(main, 'parseHDR') + ')');

let pass=0, fail=0;
function ok(name, cond){ if(cond){ pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } }
function close(a, b, eps){ return Math.abs(a-b) < (eps||1e-6); }

// ---- 字节构造 helper ----
function header(h, w, badFormat){
  let s = '#?RADIANCE\n';
  s += badFormat ? 'FORMAT=rgb_xyze\n' : 'FORMAT=32-bit_rle_rgbe\n';
  s += '\n-Y ' + h + ' +X ' + w + '\n';
  return s;
}
function bytes(str){ return Uint8Array.from(str, c => c.charCodeAt(0)); }
function cat(...parts){  // (Uint8Array|string)[]
  let len = 0;
  for(const p of parts) len += (typeof p === 'string' ? p.length : p.length);
  const out = new Uint8Array(len); let o = 0;
  for(const p of parts){ const a = typeof p === 'string' ? bytes(p) : p; out.set(a, o); o += a.length; }
  return out;
}

console.log('Lumen HDRI(.hdr) 解码测试');

// ---- 1. header 与魔数 ----
(()=>{
  ok('坏魔数 → null', parseHDR(bytes('X?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\x80\x80\x80\x88')) === null);
  ok('缺 FORMAT 行 → null', parseHDR(bytes('#?RADIANCE\n\n-Y 1 +X 1\n\x80\x80\x80\x88')) === null);
  ok('错误 FORMAT → null', parseHDR(cat(header(1,1,true), bytes('\x80\x80\x80\x88'))) === null);
  ok('非标准扫描方向(+Y) → null', parseHDR(bytes('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+Y 1 +X 1\n\x80\x80\x80\x88')) === null);
  ok('分辨率行缺失(无空行结束) → null', parseHDR(bytes('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n')) === null);
})();

// ---- 2. old-style 直通行展开 ----
(()=>{
  // 2 像素一行：p0=(128,128,128,E=136)→128；p1=(64,32,16,E=135)→(32,16,8)
  const buf = cat(header(1,2), bytes('\x80\x80\x80\x88' + '\x40\x20\x10\x87'));
  const r = parseHDR(buf);
  ok('直通行：宽高解析', r && r.width===2 && r.height===1);
  ok('直通行：E=136 → 128.0', r && close(r.data[0], 128));
  ok('直通行：E=135 → 半值 (32,16,8)', r && close(r.data[3],32) && close(r.data[4],16) && close(r.data[5],8));
})();

// ---- 3. E=0 黑像素与数值精度 ----
(()=>{
  const buf = cat(header(1,1), bytes('\x00\x00\x00\x00'));
  const r = parseHDR(buf);
  ok('E=0 → 全 0（黑像素）', r && r.data[0]===0 && r.data[1]===0 && r.data[2]===0);
  const big = cat(header(1,1), bytes('\xFF\xFF\xFF\x96'));    // E=150 → 255*2^14
  const rb = parseHDR(big);
  ok('高动态范围：E=150 → 255*2^14 = 4177920', rb && close(rb.data[0], 255*Math.pow(2,14)));
})();

// ---- 4. RLE 扫描线：run / 字面量 / 混合 ----
(()=>{
  // W=8（RLE 资格），H=1。R 通道全 run(8 个 100)：[136,100]；G 通道字面量 8 字节；B 通道混合 run(3)+lit(5)；E 全 run(8 个 136)
  const rChan = bytes('\x88\x64');                                  // 136=128+8 → 8 个 100
  const gChan = bytes('\x08\x0A\x14\x1E\x28\x32\x3C\x46\x50');      // 字面量 8（计数字节 + 8 数据）
  const bChan = cat(bytes('\x83\x05'), bytes('\x05\x06\x07\x08\x09\x0A'));  // run(3 个 5) + 字面量 5（+5 数据）
  const eChan = bytes('\x88\x88');                                  // 8 个 E=136
  const buf = cat(header(1,8), bytes('\x02\x02\x00\x08'), rChan, gChan, bChan, eChan);
  const r = parseHDR(buf);
  ok('RLE 行：宽高解析', r && r.width===8 && r.height===1);
  ok('RLE run：R 通道 8 像素全 100', r && r.data[0]===100 && r.data[21]===100);
  ok('RLE 字面量：G 通道逐字节展开', r && r.data[1]===10 && r.data[4]===20 && r.data[7*3+1]===80);
  ok('RLE 混合：B 通道 run+lit 无缝衔接', r && r.data[2]===5 && r.data[2*3+2]===5 && r.data[3*3+2]===6 && r.data[7*3+2]===10);
  ok('RLE 通道独立性：E=136 → 乘 1', r && r.data[0]===100 && r.data[7*3]===100);
})();

// ---- 5. 多行顺序（H=2，顶行/底行数据位置正确） ----
(()=>{
  // 每行 1 像素直通：顶行 E=136(值 10)，底行 E=136(值 20)
  const buf = cat(header(2,1), bytes('\x0A\x0A\x0A\x88'), bytes('\x14\x14\x14\x88'));
  const r = parseHDR(buf);
  ok('多行：顶行在前', r && close(r.data[0], 10) && close(r.data[1], 10) && close(r.data[2], 10));
  ok('多行：底行随后', r && close(r.data[3], 20) && close(r.data[5], 20));
})();

// ---- 6. 截断与坏数据 ----
(()=>{
  ok('直通行截断 → null', parseHDR(cat(header(1,2), bytes('\x80\x80\x80\x88\x40\x20'))) === null);
  ok('RLE 行头宽度不匹配 → null', parseHDR(cat(header(1,8), bytes('\x02\x02\x00\x07'), bytes('\x88\x64'), bytes('\x08\x00'), bytes('\x88\x64'), bytes('\x88\x64'))) === null);
  ok('RLE 通道截断(run 越界) → null', parseHDR(cat(header(1,8), bytes('\x02\x02\x00\x08'), bytes('\x8A\x01'))) === null);
  ok('RLE 通道截断(字面量越界) → null', parseHDR(cat(header(1,8), bytes('\x02\x02\x00\x08'), bytes('\x08\x01\x02\x03'))) === null);
  ok('数据整体截断(行缺失) → null', parseHDR(cat(header(2,1), bytes('\x0A\x0A\x0A\x88'))) === null);
})();

// ---- 7. RLE 行头边界（width<8 走直通；误判防护）----
(()=>{
  // W=4（<8），首像素恰好 (2,2,...) 也不得被当 RLE 行头 → 直通读 4 像素
  const buf = cat(header(1,4), bytes('\x02\x02\x02\x88' + '\x20\x20\x20\x88' + '\x40\x40\x40\x88' + '\x60\x60\x60\x88'));
  const r = parseHDR(buf);
  ok('W<8 首字节 (2,2) 不误判 RLE，按直通解码', r && r.width===4 && close(r.data[0], 2*Math.pow(2,136-136)) && close(r.data[9], 0x60));
})();

// ---- 8. hdrDecodeChan 直测 ----
(()=>{
  const out = new Uint8Array(4);
  const r1 = hdrDecodeChan(bytes('\x04\x01\x02\x03\x04'), 0, 4, out);
  ok('decodeChan：字面量整段 + 返回新位置', r1 === 5 && out[0]===1 && out[3]===4);
  const out2 = new Uint8Array(4);
  const r2 = hdrDecodeChan(bytes('\x84\x09'), 0, 4, out2);
  ok('decodeChan：run 填充', r2 === 2 && out2[0]===9 && out2[3]===9);
  const r3 = hdrDecodeChan(bytes('\x04\x01'), 0, 4, out2);
  ok('decodeChan：字面量截断 → -1', r3 === -1);
  const r4 = hdrDecodeChan(bytes('\x87\x09'), 0, 3, out2);
  ok('decodeChan：run 越界目标 → -1', r4 === -1);
})();

console.log('Lumen HDRI 解码: ' + pass + ' pass, ' + fail + ' fail');
if(fail > 0) process.exit(1);
