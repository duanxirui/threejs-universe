# COSMOS ATLAS V2.0 · 沉浸式 3D 宇宙图鉴

Three.js + Vite + GSAP 构建的交互式银河系、太阳系与行星探索应用。

## 本地启动

需要 Node.js 20.19+ 和支持 WebGL2 的现代浏览器。

```bash
npm install
npm run dev
```

终端会显示本地地址（默认 `http://localhost:5173/`）。生成发布文件：

```bash
npm run build
npm run preview
```

将 `dist/` 目录部署在静态网站服务即可。所有天体贴图位于 `public/textures/`，无需在运行时请求第三方贴图服务器。

## V2 功能

- 银河系：四条旋臂、星云/星际尘埃、恒星粒子及可点击太阳系定位标记。
- 太阳系：太阳与八大行星、近似开普勒椭圆轨道、显示比例缩放的小行星带。
- 天体细节：本地 2K 太阳及行星纹理、约 1K 卫星纹理、动态太阳表面与日冕、地球云层和大气辉光、示意性夜间城市灯光、土星与天王星环。
- 卫星：月球、木卫一、木卫二、木卫三、木卫四、土卫六、海卫一。可从母星资料卡或搜索进入。
- 交互：电影式镜头飞行、持续目标跟随、天体搜索、时间暂停/倍速、轨道及标签显隐、参数对比。
- 性能：移动端降低星云粒子密度、行星几何体 LOD、自动 DPR 调节，以及可选 Bloom 后期处理。
- 界面：中文天体数据、手机抽屉面板、自由漫游速度及高/低画质控制。

## 操作

| 操作 | 效果 |
| --- | --- |
| 左键拖动 / 单指拖动 | 旋转相机 |
| 滚轮 / 双指缩放 | 拉近或远离 |
| 右键拖动 / 双指平移 | 平移视角 |
| 点击行星或搜索天体 | 镜头飞近并锁定目标 |
| 点击资料卡中的卫星 | 转至卫星近景 |
| 自由漫游下 W/A/S/D | 前后左右飞行 |
| 空格 / Shift | 在自由漫游中上升 / 下降 |
| `/` | 打开搜索 |
| Esc | 关闭弹窗或返回太阳系 |
| 手机资料卡把手 | 点按循环折叠/展开；上下拖动控制高度 |

## 目录

```
src/
  core/UniverseApp.js             场景、镜头、后期渲染、性能和输入
  data/celestials.js              八大行星及七颗主要卫星数据
  universe/createGalaxy.js        银河旋臂、星云、太阳系标记
  universe/createSolarSystem.js   行星、卫星、小行星、光照及纹理加载
  universe/orbitalMechanics.js    椭圆轨道、开普勒方程
  universe/textureManager.js      异步加载本地图像，失败时回退程序化表面
  universe/proceduralTextures.js  Shader 与程序化光效
  main.js                         UI、搜索、对比、响应式交互
  styles.css                      第一版基础主题
  v2.css                          第二版样式
public/textures/                  本地纹理与来源说明
```

## 科普与许可声明

星球尺寸、相对距离和运动速度采用**演示缩放**，画面中的“演示时间”并非 NASA/JPL 历表。部分轨道参数参考真实天文偏心率与倾角，起始相位为演示设置。真实影像、模拟地貌以及程序化视觉效果有明确区分。

第三方贴图和许可说明参阅 [`public/textures/ATTRIBUTION.md`](public/textures/ATTRIBUTION.md)。CC BY 4.0 纹理需要保留创作者署名。
