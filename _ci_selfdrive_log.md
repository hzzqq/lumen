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

---

# 5 轮迭代日志（ci377 / ci381 / ci385 / ci389 / ci393）

> 本轮为 ci377–ci393：在既有 12 步接线范式下，为 5 个后处理效果补互补控制（避开已占用的 uBloom/uGlow/uGrain/uScanline/uContrast/uSatStr）。
> 纪律：R1 每轮注入新需求（效果本身）；R2 每轮挖 1 个隐性问题并修复（数值安全/输入校验轴）；R3 ≥2 质量轴有真实改动；R6 可验证（`node --check` + `_ci377_393_effects_test.js` 均 pass，字段数 118 > 111）。
> 验收：`node --check main.js`（0 errors）；`node _ci377_393_effects_test.js`（PASS，serializeScene 字段数 118，presetToParams 字段数 117）。

## ci377 · Bloom 泛光阈值覆盖（uBloomThreshold，互补既有 uBloom）
- new_requirement: 实现可独立覆盖泛光阈值的控制 uBloomThreshold（>0 时覆盖默认 uBloomThr=1.0，0 时沿用默认），配合既有 uBloom 开关，使 Bloom 可在不改动基准效果的前提下单独调阈。
- implicit_fix: SHOW 末尾原 `outColor = vec4(c, 1.0)` 未做任何边界处理，任一上游效果在 HDR 越界或产生 NaN/inf 时都会直接写入 8bit 缓冲造成花屏/黑屏 → 补终末 `outColor = vec4(clamp(c, 0.0, 1.0), 1.0)` NaN/inf 钳制守卫（数值安全/空值防护轴）。
- 质量轴: 数值安全（终末钳制）+ 可读性（注释说明守卫用途）。
- 验证: node --check PASS；_ci377_393_effects_test PASS；字段数 118；presetToParams 117。

## ci381 · Glow 柔光阈值覆盖（uGlowThreshold，互补既有 uGlow）
- new_requirement: 实现柔光阈值覆盖 uGlowThreshold（>0 时覆盖默认 0.6），让 uGlow 高亮伪泛光可在不改基准效果时单独调起辉阈值。
- implicit_fix: glow 分支 `c += uGlow * g * c` 原为无界叠加，强 uGlow 下亮区会过曝 >1 并经后续混合放大误差 → 在分支内加 `c = clamp(c + uGlow * g * c, 0.0, 1.0)`（数值安全轴）。
- 质量轴: 数值安全（分支钳制）+ 可观测性（注释说明阈值语义）。
- 验证: node --check PASS；测试 PASS；字段数 118。

## ci385 · FilmGrain 颗粒缩放（uGrainAmount，互补既有 uGrain/uGrainStr）
- new_requirement: 实现胶片颗粒额外缩放 uGrainAmount（1=原 uGrainStr，>1 更粗），作为既有 uGrain 的乘性微调，不改动基准噪点算法。
- implicit_fix: 颗粒叠加未做单通道边界处理且 `grainAmount` 经 import/preset 越界会放大噪声淹没画面 → 分支内 `c = clamp(c + vec3(n), 0.0, 1.0)` 钳制，并在 deserialize 对 `grainAmount` 做 [0,3] 钳制（数值安全 + 输入校验轴）。
- 质量轴: 数值安全（分支钳制）+ 输入校验（grainAmount 范围）。
- 验证: node --check PASS；测试 PASS；字段数 118。

## ci389 · CRT Scanlines 增强扫描线（uScanlines，互补既有 uScanline）
- new_requirement: 实现增强版 CRT 扫描线 uScanlines（纵向周期压暗，密度固定、强度 0=关/1=最深），作为既有 uScanline 的密度/强度可配补充。
- implicit_fix: `scanline` 字段在 deserialize 未做 [0,1] 钳制，导入越界值会让扫描线对比度反相甚至全黑 → 加 `Math.max(0, Math.min(1, num('scanline', 0)))` 钳制；分支内 `c = clamp(c * mix(1.0, s, uScanlines), 0.0, 1.0)` 钳制（输入校验 + 数值安全轴）。同批对既有 `solarize`/`infrared` 也补 [0,1] 钳制（历史越界隐患）。
- 质量轴: 输入校验（scanline/solarize/infrared 钳制）+ 数值安全（分支钳制）。
- 验证: node --check PASS；测试 PASS；字段数 118。

## ci393 · ColorGrade 专业调色（uColorGrade + uSaturation + uGradeContrast）
- new_requirement: 实现专业调色 uColorGrade（总强度），内含饱和度 uSaturation（1=原色）与对比度 uGradeContrast（1=原图），作为既有 uSatStr/uContrast 之外的独立调色档。
- implicit_fix: 调色分支 `graded = (graded - 0.5) * uGradeContrast + 0.5` 在高对比度下会产生 <0 或 >1 溢出污染混合 → 分支内 `graded = clamp((graded - 0.5) * uGradeContrast + 0.5, 0.0, 1.0)` 与 `c = clamp(mix(c, graded, uColorGrade), 0.0, 1.0)` 双钳制（数值安全轴）。
- 质量轴: 数值安全（双钳制）+ 可读性（注释说明 S/C 契约）。
- 验证: node --check PASS；_ci377_393_effects_test PASS；字段数 118；并新增预设「电影感夜景」演练全部 7 字段。
