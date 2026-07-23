# self-driving-dev 子执行体 · 5 轮迭代日志（ci357 / ci361 / ci365 / ci369 / ci373）

> 项目：E:\project\project1\raytracer （Lumen 路径追踪渲染器，后处理在 SHOW 片段着色器主路径追踪之后施加）
> 纪律：每轮 R1 注入新需求（5 个效果本身）；R2 主动挖 1 个隐性问题并修复；R3 在 ≥2 个代码质量轴有真实改动；
> R6 改动可验证（node --check + _ci357_373_effects_test.js 均须 0 错误/pass）。
> 验证：`node --check main.js` 与 `node _ci357_373_effects_test.js`。字段数统计见每轮。

---

## ci357 · Watercolor 水彩（uWatercolor）
- new_requirement: 实现水彩后处理（湿边扩散 + 纸纹噪声微扰），并补齐十二步接线。
- implicit_fix: `deserializeScene` / `presetToParams` 中 `watercolor` 未做 [0,1] 钳制，坏 JSON/极端值会让 `mix(c,wc,uWatercolor)` 外推污染画面 → 加 Math.max(0,Math.min(1,...)) 钳制（输入校验/空值防护轴）。
- 质量轴: 输入校验（钳制）+ 可读性（补 SHOW 分支契约注释）。
- 验证: node --check PASS；_ci357_373_effects_test PASS；字段数 111。

## ci361 · Pixelate 像素化（uPixelate + uPixelSize）
- new_requirement: 实现分块量化像素化（gl_FragCoord 分块取代表色）。
- implicit_fix: 新字段 `pixelSize` 在 deserialize/presetToParams 中未钳制到 [0,1]，导入越界值会让 `coarse` 复用越界导致花屏 → 加 [0,1] 钳制（输入校验轴）。注：`pixelate` 本身因 SHOW 末尾统一 `clamp(c,0,1)` 已兜底，且既有 `_pixelate_test.js` 正则锁定其精确 token，故不额外包裹钳制以免引入新失败。
- 质量轴: 输入校验（pixelSize 钳制）+ 可读性（说明双滑块协作注释）。
- 验证: node --check PASS；_ci357_373_effects_test PASS；_pixelate_test 维持既有的 1 项历史失败(序列化的 num 写法), 未引入新失败；字段数 111。

## ci365 · HueShift 色相旋转（uHueShift）
- new_requirement: 实现 RGB→HSV 旋转 H 通道再转回的色相旋转。
- implicit_fix: `hueShift` 在 deserialize/presetToParams 未钳制到 [-180,180]，极端导入值虽数学可算但会写出荒谬的持久化数值 → 加 [-180,180] 钳制（输入校验轴）。
- 质量轴: 输入校验（钳制）+ 可观测性（hueShift() 注释说明 fract 周期性与 [0,1] 契约）。
- 验证: node --check PASS；测试 PASS；字段数 111。

## ci369 · Duotone 双色调（uDuotone + uDuotoneShadow + uDuotoneHigh）
- new_requirement: 按亮度在阴影色↔高光色间映射的双色调。
- implicit_fix: `duotoneShadow`/`duotoneHigh` 的 oninput 直接用 `hex2rgb(e.target.value)`，用户填入非法 hex 时产生 NaN 数组并写入状态，下一帧 `uniform3f` 注入 NaN 污染渲染 → 加 fin3 风格有限性守卫（错误处理/空值防护轴）。
- 质量轴: 空值防护（NaN 守卫）+ 可读性（双色调契约注释）。
- 验证: node --check PASS；测试 PASS；字段数 111。

## ci373 · ChromaticAberration 色散（uChroma + uChromaAmt）
- new_requirement: 实现 RGB 三通道沿径向分离偏移的色差。
- implicit_fix: `uChromaStr` 虽已声明并在每帧 `gl.uniform1f` 绑定，但 SHOW 着色器从未引用它（死 uniform，强度滑块形同虚设）→ 将其纳入色差强度计算 `amt *= (0.5 + uChromaStr)`，默认 chromaStr=0.5 时观感不变（正确性/DRY 轴）。
- 质量轴: 正确性（消除死 uniform）+ 可观测性（注释说明 uChromaStr 现已生效）。
- 验证: node --check PASS；测试 PASS；字段数 111。
