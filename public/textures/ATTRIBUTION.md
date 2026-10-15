# COSMOS ATLAS V2.0 — 纹理素材来源

本项目使用公开的天体表面纹理，随应用一起分发。感谢素材创作者及 NASA / USGS 的观测数据。

## 太阳与八大行星

`sun.jpg`, `mercury.jpg`, `venus.jpg`, `earth.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg`

- 原始纹理作者：**Solar System Scope** ([纹理来源](https://www.solarsystemscope.com/textures/))
- 镜像仓库：[Sanghel/solar-system-3d](https://github.com/Sanghel/solar-system-3d/tree/develop/public/textures)
- 许可：[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- 使用方法：原始 2K equirectangular 图像不改动，在 Three.js 中映射到动态球体并应用光照及着色器。

这些纹理基于 NASA 等天文影像和高程资料；为了视觉呈现，Solar System Scope 调整了饱和度，并对未充分测绘的区域使用了近似地貌。

## 天然卫星

`satellites/moon.jpg` 来源于 Solar System Scope，同为 CC BY 4.0。

`satellites/io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg`, `titan.jpg`, `triton.jpg` 来自 [Sanghel/solar-system-3d](https://github.com/Sanghel/solar-system-3d/tree/develop/public/textures/satellites) 收集的 USGS Astrogeology / NASA 任务影像（Galileo、Voyager、Cassini）。

该仓库的 [Texture Attributions](https://github.com/Sanghel/solar-system-3d/blob/develop/public/textures/README.md) 将六张卫星图归为 USGS / NASA 公共领域任务影像。项目保留 NASA / USGS 来源署名；若后续用于商业发布，仍建议核查各幅 USGS 拼接图的处理者署名和具体使用说明。

## 程序化视觉内容

动态星云、银河粒子、太阳日冕、地球云层、土星环着色器以及地球夜间城市灯光由项目代码生成。城市灯光为演示性分布，**不是卫星观测的真实夜光影像**。

整个应用采用适合屏幕探索的展示比例；天体轨道与时间模拟不应用于天文测量或精确预报。
