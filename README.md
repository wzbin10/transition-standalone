# transition-standalone

**8 种 WebGL 转场特效独立封装，零依赖。**

一个 `<canvas>` + 两张图片/视频，就能在任意纯 HTML 页面里跑出电影感的镜头转场。所有效果由单个 GLSL 片元着色器实时计算，无需视频素材、无需构建流程、无第三方运行时依赖。

- 8 种可切换镜头模式
- 零依赖，仅 ESM / CJS 两种产物，体积小
- A/B 双路媒体（图片、视频、canvas 均可）
- GPU 自动分档，按设备性能选择渲染分辨率
- 纹理增量上传，静态媒体不重复上传，动态媒体可冻结
- TypeScript 编写，完整类型定义

---

## 安装

```bash
npm install transition-standalone
```

或使用 pnpm / yarn：

```bash
pnpm add transition-standalone
```

也可以直接把 [src/index.ts](src/index.ts) 拷进项目，它本身就是一个自包含的单文件模块。

---

## 快速上手

```ts
import { TransitionRenderer, TransitionMode } from "transition-standalone";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new TransitionRenderer(canvas);

// 设置 A（起始）/ B（目标）两路媒体
renderer.setMediaA(imgA);
renderer.setMediaB(imgB);

// 选一个镜头模式
renderer.mode = TransitionMode.RADIAL_BLOOM;

function loop(now: number) {
  // progress: 0 ~ 1，time: 毫秒时间戳（驱动噪声动画）
  renderer.render({ progress: 0.5, time: now });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

`render()` 也支持位置参数简写：

```ts
renderer.render(0.5, performance.now());
```

### 关于透明语义（重要）

WebGL canvas 需要叠在「A 画面」的 DOM 之上使用，因为：

| progress | 输出 |
| --- | --- |
| `<= 0.0015` | 完全透明（`alpha = 0`），底层 DOM 可见 |
| `0.0015 ~ 0.9985` | 按 mask 混合，`alpha = mask`；纯 A 区域透明（露出 DOM），纯 B 区域不透明 |
| `>= 0.9985` | 纯 B 画面，完全不透明 |

也就是说：**把 A 画面作为底层 DOM 元素，把 canvas 绝对定位盖在上面**，即可获得正确的视觉效果。`src/index.html` 示例正是这样组织的。

---

## 8 种镜头模式

| 值 | 枚举 | 名称 | 效果 |
| --- | --- | --- | --- |
| 0 | `TransitionMode.ICE_CUT` | ICE CUT | 斜向多通道噪声切割，冰晶纹理 + 边缘发光 |
| 1 | `TransitionMode.CENTER_PUSH` | CENTER PUSH | 双相机冲向焦点，新画面从中心推开旧画面 |
| 2 | `TransitionMode.RADIAL_BLOOM` | RADIAL BLOOM | 径向光晕自中心向四周扩张覆盖全屏 |
| 3 | `TransitionMode.PRISM_DRIFT` | PRISM DRIFT | 连续棱镜平面滑过，色散条带错位后合并 |
| 4 | `TransitionMode.LIQUID_VEIL` | LIQUID VEIL | 折射垂直帷幕，流体噪声扭曲画面 |
| 5 | `TransitionMode.DOLLY_ZOOM` | DOLLY ZOOM | 希区柯克滑动变焦，A 放大退去、B 缩小进入 |
| 6 | `TransitionMode.NEON_SWEEP` | NEON SWEEP | 斜向霓虹光带扫过，带青紫色散 |
| 7 | `TransitionMode.ORBIT_WARP` | ORBIT WARP | 对旋轨道相机，弧形轨迹旋转扭曲 + 运动模糊 |

模式名数组与枚举顺序一一对应，可直接用于 UI 渲染：

```ts
import { TRANSITION_MODE_LABELS } from "transition-standalone";

TRANSITION_MODE_LABELS; // ["ICE CUT", "CENTER PUSH", ..., "ORBIT WARP"]
```

---

## API

### `new TransitionRenderer(canvas, options?)`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | 用于输出的 canvas |
| `options.qualityTier` | `QualityTier` | 手动指定质量档位，优先级高于自动检测 |
| `options.autoDetect` | `boolean` | 是否自动检测 GPU 分档，默认 `true` |

WebGL 不可用时不会抛错，而是把 `supported` 置为 `false`，此时 `render()` 恒返回 `false`。

### 实例属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | 只读，构造时传入的 canvas |
| `gl` | `WebGLRenderingContext \| null` | 只读，WebGL 上下文 |
| `supported` | `boolean` | 只读，WebGL 是否可用 |
| `mode` | `TransitionMode` | 当前镜头模式，可直接赋值切换，默认 `ICE_CUT` |
| `energy` | `number` | 能量值，影响位移/色散强度，默认 `1` |
| `overlayOnly` | `boolean` | 视频叠加模式（蓝白色调覆盖），默认 `false` |

### 实例方法

#### 媒体设置

```ts
setMediaA(media: TexImageSource | null, key?: string): void;
setMediaB(media: TexImageSource | null, key?: string): void;
setMediaPair(mediaA, mediaB, keyA?, keyB?): void;
```

支持 `HTMLImageElement` / `HTMLVideoElement` / `HTMLCanvasElement`，传 `null` 清除。`key` 用于标记媒体来源，key 变化会强制重新分配纹理。

#### 尺寸

```ts
resize(preserveSharpness = false): void;
```

按 canvas 的 CSS 尺寸 × DPR 设置 drawing buffer。`render()` 内部会自动调用，通常无需手动调用。`preserveSharpness = true` 时 DPR 上限放宽到 2。

#### 渲染

```ts
render(options: TransitionRenderOptions): boolean;
render(progress: number, time: number): boolean;
```

上传一帧并绘制，返回是否渲染成功。

```ts
export interface TransitionRenderOptions {
  /** 过渡进度 0~1（0 = 纯 A，1 = 纯 B） */
  progress: number;
  /** 时间戳（毫秒，驱动噪声动画，推荐 performance.now()） */
  time: number;
  /** 能量值 0.72~1.9，默认取实例的 energy */
  energy?: number;
  /** 镜头模式 0~7，默认取实例的 mode */
  mode?: TransitionMode;
  /** 视频叠加模式，默认取实例的 overlayOnly */
  overlayOnly?: boolean;
  /** 视频全帧模式（保留锐度，提高 DPR 上限），默认 false */
  videoFullFrame?: boolean;
  /** 冻结动态源上传（预热帧），默认 false */
  freezeDynamic?: boolean;
}
```

#### 质量档位

```ts
setQuality(tier: QualityTier): void;
getQuality(): QualityTier;
```

| 档位 | DPR 上限 | 效果强度 |
| --- | --- | --- |
| `high` | 1.75 | 1 |
| `medium` | 1.25 | 0.82 |
| `low` | 1 | 0.66 |

> 注意：档位在初始化时应用一次并影响 drawing buffer 尺寸，运行中切换后建议调用一次 `resize()`。

#### 预热与清理

```ts
warm(mode?: TransitionMode): void;  // 用当前媒体做一次 progress=0 静态渲染，预编译着色器、分配纹理，消除首次转场卡顿
invalidate(): void;                 // 清除纹理缓存，下次 render 强制重新上传
dispose(): void;                    // 释放 program / texture 等 WebGL 资源
```

`warm()` 需要在已经设置好媒体之后调用。

### `detectQualityTier()`

```ts
export function detectQualityTier(): { tier: QualityTier; supported: boolean };
```

读取 `WEBGL_debug_renderer_info` 判断 GPU 型号并给出档位；无 WebGL 时返回 `{ tier: "low", supported: false }`。

### 底层导出

```ts
export const VERTEX_SHADER: string;   // GLSL 顶点着色器源码
export const FRAGMENT_SHADER: string; // GLSL 片元着色器源码
```

---

## 示例

[src/index.html](src/index.html) 是一个不依赖任何构建工具的完整 demo，包含：

- 双图 A/B 切换与文件替换（内置两张生成图，无需网络素材）
- 模式下拉切换（读取 `TRANSITION_MODE_LABELS`）
- 进度滑块 + 自动播放（乒乓往返）
- 能量滑块、`warm()` 预热按钮
- 质量档位手动/自动切换

运行方式（需先构建出 `dist/` 或改用 TS 开发服务器）：

```bash
npm install
npm run build
npx serve .          # 或任意静态服务器，然后打开 /src/index.html
```

如果你用 Vite 之类的 TS 开发服务器，可把示例顶部的导入改成 `./index.ts` 直接调试源码。

---

## 浏览器支持

依赖 WebGL 1.0（`canvas.getContext("webgl")`）。所有现代桌面与移动浏览器均支持。WebGL 不可用或着色器编译失败时，构造器不会抛异常：

```ts
const renderer = new TransitionRenderer(canvas);
if (!renderer.supported) {
  // 降级：直接展示静态图片或 CSS 过渡
}
```

跨域图片需带 CORS 响应头（`crossOrigin = "anonymous"`），否则纹理上传会失败。

---

## 开发

```bash
npm install
npm run dev     # tsup watch，产物输出到 dist/
npm run build   # 构建 ESM + CJS + d.ts
```

产物：

```
dist/index.js    ESM
dist/index.cjs   CJS
dist/index.d.ts  类型声明
```

---

## License

[MIT](LICENSE) © 2026 wzbin10
