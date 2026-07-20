# Lumen · WebGL2 实时路径追踪器

> 零依赖、纯原生 WebGL2 + GLSL 实现的蒙特卡洛路径追踪器（Monte Carlo Path Tracer），浏览器内实时收敛出全局光照、软阴影、焦散、菲涅尔玻璃与金属。

![tech](https://img.shields.io/badge/WebGL2-Path%20Tracing-c792ea) ![deps](https://img.shields.io/badge/dependencies-0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 特性

- **蒙特卡洛路径追踪**：ping-pong 双 RGBA32F 浮点累积缓冲，逐帧累加样本、自适应收敛。
- **球体 / 三角形求交**：三角形采用 Möller–Trumbore 算法。
- **BVH 加速结构**：JS 端中点分割构建 BVH，节点 + 三角形打包进 RGBA32F 浮点纹理，GLSL 内栈式遍历。
- **真实材质**：漫反射、金属（菲涅尔反射）、玻璃（折射 + 全内反射 + 菲涅尔）、自发光。
- **程序化 HDRI 天空**：渐变天穹 + 太阳，作为环境光（IBL）直接采样。
- **景深 DOF**：薄透镜近似，焦距 / 光圈可调。
- **体积雾**：按光线段长 exp 衰减 + 天空照亮雾。
- **俄罗斯轮盘提前终止**：深度 > 3 时按吞吐概率提前终止低贡献路径，同等开销采样更多路径 → **效率提升**。
- **色调映射**：ACES Filmic / Reinhard / 线性可切换。
- **自动曝光**：周期回读累积缓冲中心 64×64 区块亮度，归一化到目标曝光值。
- **多场景**：6 个内置场景（彩球墙、Cornell Box、玻璃/金属厅等），可自动旋转、保存 PNG。

## 🧱 技术栈

`WebGL2` · `GLSL ES 300` · 零运行时依赖（纯手写，无 three.js / 无构建工具）

## 🚀 运行

需通过 HTTP 提供页面（浮点纹理 / CORS 要求），不能直接 `file://` 打开。

```bash
# 任意静态服务器
python -m http.server 8080
# 然后浏览器打开 http://localhost:8080/index.html
```

UI 滑块可实时调节：相机、焦距、光圈、曝光、雾密度、俄罗斯轮盘开关、色调映射、自动曝光。

## 🏗 架构

```
main.js
 ├─ WebGL2 上下文 + 双 accumulation framebuffer（ping-pong）
 ├─ 场景定义（球体 / 三角形 / 面光源）
 ├─ JS 端 buildBVH() → packAndUpload() 打包进浮点纹理
 ├─ 路径追踪片元着色器（PT_FRAG）：递归求交、BSDF 采样、俄罗斯轮盘
 ├─ 显示片元着色器（SHOW_FRAG）：色调映射 + 自动曝光
 └─ 自动旋转 / 累积重置 / PNG 导出（preserveDrawingBuffer）
```

## 📄 许可

MIT © hzzqq
