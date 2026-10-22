# COSMOS ATLAS — 纹理素材来源

本项目使用公开的天体表面纹理，随应用一起分发。感谢素材创作者及 NASA / USGS 的观测数据。

## 太阳与八大行星

`sun.jpg`, `mercury.jpg`, `venus.jpg`, `earth.jpg`, `mars.jpg`, `jupiter.jpg`, `saturn.jpg`, `uranus.jpg`, `neptune.jpg`

- 原始纹理作者：**Solar System Scope** ([纹理来源](https://www.solarsystemscope.com/textures/))
- 镜像仓库：[Sanghel/solar-system-3d](https://github.com/Sanghel/solar-system-3d/tree/develop/public/textures)
- 许可：[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- 使用方法：原始 2K equirectangular 图像不改动，在 Three.js 中映射到动态球体并应用光照及着色器。

这些纹理基于 NASA 等天文影像和高程资料；为了视觉呈现，Solar System Scope 调整了饱和度，并对未充分测绘的区域使用了近似地貌。

## 离线 KTX2 压缩版本

`ktx2/uranus.ktx2`、`ktx2/neptune.ktx2` 由上述 Solar System Scope 的 `uranus.jpg`、`neptune.jpg` 转码；`ktx2/satellites/callisto.ktx2` 由下文 NASA / USGS 来源的 `satellites/callisto.jpg` 转码。三份文件为**现有天体纹理的压缩衍生版本**，不是新增拍摄或测绘素材。保留各源 JPG、署名及原有许可条件；网站在 ETC2 不支持或压缩纹理加载失败时使用 JPG 回退。

离线编码脚本位于 `scripts/encode-etc2-ktx2.mjs`，生成 ETC2 RGB8 + mipmap + Zstd 的 KTX2；只有当压缩纹理比 JPG 更小且质量符合阈值时才启用。文件体积改善不代表真实天体观测精度提升。

## 天然卫星

`satellites/moon.jpg` 来源于 Solar System Scope，同为 CC BY 4.0。

`satellites/io.jpg`, `europa.jpg`, `ganymede.jpg`, `callisto.jpg`, `titan.jpg`, `triton.jpg` 来自 [Sanghel/solar-system-3d](https://github.com/Sanghel/solar-system-3d/tree/develop/public/textures/satellites) 收集的 USGS Astrogeology / NASA 任务影像（Galileo、Voyager、Cassini）。

该仓库的 [Texture Attributions](https://github.com/Sanghel/solar-system-3d/blob/develop/public/textures/README.md) 将六张卫星图归为 USGS / NASA 公共领域任务影像。项目保留 NASA / USGS 来源署名；若后续用于商业发布，仍建议核查各幅 USGS 拼接图的处理者署名和具体使用说明。

## 程序化视觉内容

动态星云、银河粒子、太阳日冕、地球云层、土星环着色器以及地球夜间城市灯光由项目代码生成。城市灯光为演示性分布，**不是卫星观测的真实夜光影像**。

地球、月球和火星的表面法线纹理通过 `src/universe/surfaceDetail.js` 在本地由上述已有彩色纹理**估算生成**；地球另根据海陆颜色估算粗糙度，以模拟海洋的光照反射。这些是演示性视觉增强，并非 NASA / USGS 的真实地形高程产品。若彩色纹理无法加载，将尝试从程序化底图生成法线；法线生成失败时保留普通彩色材质。

2026-10-20 新增的土卫一（Mimas）、土卫二（Enceladus）、土卫三（Tethys）、土卫四（Dione）、土卫五（Rhea）和土卫八（Iapetus）没有新增外部图片资源。它们的表面颜色、撞击坑、冰裂隙、明暗半球由 `src/universe/proceduralTextures.js` 在运行时生成，**仅为科普示意，不是卫星实测贴图或真实地貌数据**。已有土卫六（Titan）继续使用上述 NASA/USGS 来源的本地 JPG。

T12 新增的球形天体遮挡阴影和木星云带纹理变形由 `src/universe/celestialLighting.js` 中的 GLSL 生成；地球等天体的大气边缘渐变增强由 `src/universe/proceduralTextures.js` 中的 GLSL 生成。以上都没有新增第三方贴图或真实天文观测数据，仅模拟可视化投影、晨昏散射及云带运动。

整个应用采用适合屏幕探索的展示比例；天体轨道与时间模拟不应用于天文测量或精确预报。
