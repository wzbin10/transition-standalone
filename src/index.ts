/**
 * transition-standalone —— 8 种 WebGL 转场特效独立封装
 *
 * 零依赖，可直接用于任意纯 HTML demo。只需一个 <canvas> 和两张图片/视频即可。
 *
 * 八种镜头模式：
 *   0  ICE CUT         斜向多通道噪声切割
 *   1  CENTER PUSH     双相机冲向焦点
 *   2  RADIAL BLOOM    新场景从中心向四周扩张
 *   3  PRISM DRIFT     连续棱镜平面滑过
 *   4  LIQUID VEIL     折射垂直帷幕
 *   5  DOLLY ZOOM      希区柯克滑动变焦
 *   6  NEON SWEEP      霓虹扫光带覆盖
 *   7  ORBIT WARP      对旋轨道相机
 *
 * 用法示例（HTML）：
 * ```html
 * <canvas id="c"></canvas>
 * <script type="module">
 * import { TransitionRenderer, TransitionMode } from './transition-standalone.ts'
 * const r = new TransitionRenderer(document.getElementById('c'))
 * r.setMediaA(imgA); r.setMediaB(imgB)
 * r.mode = TransitionMode.RADIAL_BLOOM
 * function loop(t) {
 *   r.render(0.5, t)         // progress 0~1, time ms
 *   requestAnimationFrame(loop)
 * }
 * requestAnimationFrame(loop)
 * ```
 */

// ─── 模式枚举 ───────────────────────────────────────────────

/** 转场特效模式 */
export enum TransitionMode {
  /** 冰切：从中心向两侧裂开，伴随冰晶纹理和边缘发光 */
  ICE_CUT = 0,
  /** 中心推移：新画面从中心向四周扩展推开旧画面 */
  CENTER_PUSH = 1,
  /** 径向绽放：以径向光晕展开，亮带从中心扩散覆盖全屏 */
  RADIAL_BLOOM = 2,
  /** 棱镜漂移：画面分裂为色散条带，沿水平方向错位滑动后合并 */
  PRISM_DRIFT = 3,
  /** 液态面纱：以流体噪声扭曲画面，形成液态膜逐渐覆盖 */
  LIQUID_VEIL = 4,
  /** 滑动变焦：希区柯克式缩放，A 放大退去 B 缩小进入，营造眩晕推拉感 */
  DOLLY_ZOOM = 5,
  /** 霓虹扫光：一道斜向霓虹光带扫过，光带后露出新画面，带青紫色散 */
  NEON_SWEEP = 6,
  /** 轨道翘曲：画面沿弧形轨迹旋转扭曲，带运动模糊旋入 */
  ORBIT_WARP = 7
}

/** 转场特效标签（与枚举顺序对应） */
export const TRANSITION_MODE_LABELS = [
  "ICE CUT",
  "CENTER PUSH",
  "RADIAL BLOOM",
  "PRISM DRIFT",
  "LIQUID VEIL",
  "DOLLY ZOOM",
  "NEON SWEEP",
  "ORBIT WARP"
] as const;

// ─── 质量档位 ───────────────────────────────────────────────

export type QualityTier = "high" | "medium" | "low";

interface QualityProfile {
  dpr: number;
  effect: number;
}

// ─── 着色器源码 ─────────────────────────────────────────────

export const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_texture_a;
uniform sampler2D u_texture_b;
uniform vec2 u_resolution;
uniform vec2 u_image_size_a;
uniform vec2 u_image_size_b;
uniform float u_progress;
uniform float u_time;
uniform float u_energy;
uniform float u_mode;
uniform float u_quality;
uniform float u_video_overlay;

float hash(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
    local.y
  );
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(point);
    point = point * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

vec2 coverUv(vec2 screen_uv, vec2 image_size) {
  float viewport_aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float image_aspect = image_size.x / max(image_size.y, 1.0);
  vec2 uv = screen_uv;
  if (image_aspect > viewport_aspect) {
    uv.x = (screen_uv.x - 0.5) * (viewport_aspect / image_aspect) + 0.5;
  } else {
    uv.y = (screen_uv.y - 0.5) * (image_aspect / viewport_aspect) + 0.5;
  }
  return clamp(uv, 0.0, 1.0);
}

vec4 sampleMedia(sampler2D texture_map, vec2 screen_uv, vec2 frame_uv, vec2 image_size, float chroma) {
  float viewport_aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float image_aspect = image_size.x / max(image_size.y, 1.0);
  vec2 visible_size = image_aspect > viewport_aspect
    ? vec2(1.0, viewport_aspect / image_aspect)
    : vec2(image_aspect / viewport_aspect, 1.0);
  vec2 origin = (1.0 - visible_size) * 0.5;
  vec2 texture_uv = (screen_uv - origin) / visible_size;
  vec2 frame_texture_uv = (frame_uv - origin) / visible_size;
  float seamless_mode = step(2.5, u_mode) * (1.0 - step(4.5, u_mode));
  float feather = mix(0.0015, 0.04, seamless_mode);
  float border_distance = min(
    min(frame_texture_uv.x, 1.0 - frame_texture_uv.x),
    min(frame_texture_uv.y, 1.0 - frame_texture_uv.y)
  );
  float inside = smoothstep(-feather, feather, border_distance);
  vec2 safe_uv = clamp(texture_uv, 0.0, 1.0);
  float red = texture2D(texture_map, clamp(safe_uv + vec2(chroma, 0.0), 0.0, 1.0)).r;
  float green = texture2D(texture_map, safe_uv).g;
  float blue = texture2D(texture_map, clamp(safe_uv - vec2(chroma, 0.0), 0.0, 1.0)).b;
  vec3 contained = vec3(red, green, blue);
  vec3 backdrop = texture2D(texture_map, coverUv(frame_uv, image_size)).rgb;
  float backdrop_luma = dot(backdrop, vec3(0.2126, 0.7152, 0.0722));
  backdrop = mix(backdrop, vec3(backdrop_luma), mix(0.24, 0.0, seamless_mode));
  backdrop *= mix(0.62, 1.0, seamless_mode);
  return vec4(mix(backdrop, contained, inside), 1.0);
}

void main() {
  if (u_progress <= 0.0015) {
    // progress=0：canvas 完全透明，底层 DOM 可见
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  if (u_progress >= 0.9985) {
    vec4 final_b = sampleMedia(u_texture_b, v_uv, v_uv, u_image_size_b, 0.0);
    gl_FragColor = vec4(final_b.rgb, 1.0);
    return;
  }
  float motion = sin(3.14159265 * u_progress);
  float quality = clamp(u_quality, 0.58, 1.0);
  float energy = clamp(u_energy, 0.72, 1.9);
  float broad_noise = fbm(vec2(v_uv.x * 3.1, v_uv.y * 2.35 - u_time * 0.055));
  float fine_noise = noise(vec2(v_uv.x * 15.0 + u_time * 0.13, v_uv.y * 10.0 - u_time * 0.04));
  float blue_noise = hash(gl_FragCoord.xy + vec2(mod(u_time * 71.0, 97.0), mod(u_time * 43.0, 89.0)));

  float mask = 0.0;
  float edge = 0.0;
  float tech_displacement = 0.0;
  vec2 uv_a = v_uv;
  vec2 uv_b = v_uv;
  vec2 centered = v_uv - 0.5;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float inverse_progress = 1.0 - u_progress;

  if (u_mode < 0.5) {
    // ICE CUT: 斜向多通道噪声切割
    float slope_displacement = (broad_noise - 0.5) * 0.24 * motion * energy;
    float inclination = v_uv.x * 0.18 + slope_displacement;
    float ice_displacement = (fine_noise - 0.5) * 0.075 * motion * energy;
    float boundary = mix(-0.22, 1.24, u_progress);
    float cut_position = v_uv.y + inclination + ice_displacement;
    float edge_distance = abs(cut_position - boundary);
    edge = 1.0 - smoothstep(0.012, 0.11, edge_distance);
    mask = 1.0 - smoothstep(boundary - 0.045, boundary + 0.065, cut_position);
    tech_displacement = (fine_noise - 0.5) * edge * 0.032 * energy;
    uv_a = v_uv - vec2(tech_displacement, 0.11 * u_progress * u_progress + (broad_noise - 0.5) * 0.02 * motion);
    uv_b = v_uv + vec2(tech_displacement, 0.11 * inverse_progress * inverse_progress + (broad_noise - 0.5) * 0.02 * motion);
  } else if (u_mode < 1.5) {
    // CENTER PUSH: 双相机冲向焦点
    float radius = length(centered * vec2(aspect, 1.0)) / max(0.5, length(vec2(0.5 * aspect, 0.5)));
    float signal = u_progress + (0.5 - radius) * 0.22 + (broad_noise - 0.5) * 0.08 * motion;
    edge = 1.0 - smoothstep(0.035, 0.14, abs(signal - 0.5));
    mask = smoothstep(0.43, 0.57, signal);
    float zoom_a = 1.0 + 0.72 * u_progress * u_progress;
    float zoom_b = 1.5 - 0.5 * u_progress;
    uv_a = centered / zoom_a + 0.5 - vec2(0.0, 0.07 * u_progress);
    uv_b = centered / zoom_b + 0.5 + vec2(0.0, 0.07 * inverse_progress);
    tech_displacement = (fine_noise - 0.5) * edge * 0.018 * energy;
    uv_a.x -= tech_displacement;
    uv_b.x += tech_displacement;
  } else if (u_mode < 2.5) {
    // RADIAL BLOOM: 新场景从中心向四周扩张
    float radial = length(centered * vec2(aspect, 1.0)) / max(0.5, length(vec2(0.5 * aspect, 0.5)));
    float noisy_radial = radial + (broad_noise - 0.5) * 0.16 * motion * energy + (fine_noise - 0.5) * 0.035 * motion;
    float boundary = mix(-0.08, 1.14, u_progress);
    edge = 1.0 - smoothstep(0.018, 0.12, abs(noisy_radial - boundary));
    mask = 1.0 - smoothstep(boundary - 0.045, boundary + 0.055, noisy_radial);
    float zoom_a = 1.0 + 0.16 * u_progress;
    float zoom_b = 1.18 - 0.18 * u_progress;
    uv_a = centered / zoom_a + 0.5 - vec2(0.0, 0.055 * u_progress);
    uv_b = centered / zoom_b + 0.5 + vec2(0.0, 0.055 * inverse_progress);
    tech_displacement = (fine_noise - 0.5) * edge * 0.026 * energy;
    uv_a += vec2(tech_displacement, -tech_displacement * 0.5);
    uv_b -= vec2(tech_displacement, -tech_displacement * 0.5);
  } else if (u_mode < 3.5) {
    // PRISM DRIFT: 连续棱镜平面滑过
    float prism_wave = sin(v_uv.x * 5.4 + u_time * 0.42) * 0.026;
    float prism_plane = v_uv.y + centered.x * 0.16 + prism_wave * motion;
    prism_plane += (broad_noise - 0.5) * 0.09 * motion;
    float boundary = mix(-0.24, 1.24, u_progress);
    float plane_distance = prism_plane - boundary;
    edge = 1.0 - smoothstep(0.025, 0.19, abs(plane_distance));
    mask = 1.0 - smoothstep(boundary - 0.075, boundary + 0.095, prism_plane);
    float prism_drift = (prism_wave + (fine_noise - 0.5) * 0.018) * edge * energy;
    float prism_overscan = 1.0 + 0.045 * motion;
    uv_a = centered / prism_overscan + 0.5 + vec2(prism_drift + 0.012 * u_progress * motion, 0.016 * u_progress * motion);
    uv_b = centered / prism_overscan + 0.5 - vec2(prism_drift + 0.012 * inverse_progress * motion, 0.016 * inverse_progress * motion);
    tech_displacement = prism_drift;
  } else if (u_mode < 4.5) {
    // LIQUID VEIL: 折射垂直帷幕
    float wave = sin(v_uv.x * 9.0 + u_time * 1.15) * 0.055;
    wave += sin(v_uv.x * 18.0 - u_time * 0.72) * 0.022;
    wave += (broad_noise - 0.5) * 0.16 * motion;
    float boundary = mix(-0.18, 1.18, u_progress);
    float veil_position = v_uv.y + wave * motion;
    edge = 1.0 - smoothstep(0.014, 0.105, abs(veil_position - boundary));
    mask = 1.0 - smoothstep(boundary - 0.04, boundary + 0.065, veil_position);
    float refraction = clamp((wave + (fine_noise - 0.5) * 0.028) * edge * energy, -0.052, 0.052);
    float veil_overscan = 1.0 + 0.068 * motion;
    uv_a = centered / veil_overscan + 0.5 + vec2(refraction, 0.018 * u_progress * motion);
    uv_b = centered / veil_overscan + 0.5 - vec2(refraction, 0.018 * inverse_progress * motion);
    tech_displacement = refraction;
  } else if (u_mode < 5.5) {
    // DOLLY ZOOM: 希区柯克滑动变焦
    float radial = length(centered * vec2(aspect, 1.0)) / max(0.5, length(vec2(0.5 * aspect, 0.5)));
    float dolly_noise = (broad_noise - 0.5) * 0.06 * motion;
    float dolly_boundary = mix(-0.1, 1.15, u_progress) + dolly_noise;
    edge = 1.0 - smoothstep(0.02, 0.1, abs(radial - dolly_boundary));
    mask = 1.0 - smoothstep(dolly_boundary - 0.04, dolly_boundary + 0.05, radial);
    float zoom_a = 1.0 + 0.95 * u_progress * u_progress;
    float zoom_b = 1.8 - 0.8 * u_progress;
    uv_a = centered / zoom_a + 0.5;
    uv_b = centered / zoom_b + 0.5;
    tech_displacement = (fine_noise - 0.5) * edge * 0.02 * energy;
    uv_a += vec2(tech_displacement, -tech_displacement * 0.5);
    uv_b -= vec2(tech_displacement, -tech_displacement * 0.5);
  } else if (u_mode < 6.5) {
    // NEON SWEEP: 霓虹扫光带覆盖
    float sweep_angle = 0.35;
    float sweep_wave = sin(v_uv.x * 3.2 + u_time * 0.55) * 0.03 * motion;
    float sweep_pos = v_uv.x * cos(sweep_angle) - v_uv.y * sin(sweep_angle) + sweep_wave;
    sweep_pos += (broad_noise - 0.5) * 0.08 * motion;
    float boundary = mix(-0.3, 1.3, u_progress);
    float sweep_distance = sweep_pos - boundary;
    edge = 1.0 - smoothstep(0.015, 0.09, abs(sweep_distance));
    mask = 1.0 - smoothstep(boundary - 0.03, boundary + 0.04, sweep_pos);
    float sweep_drift = (sweep_wave + (fine_noise - 0.5) * 0.015) * edge * energy;
    float sweep_overscan = 1.0 + 0.03 * motion;
    uv_a = centered / sweep_overscan + 0.5 + vec2(sweep_drift + 0.008 * u_progress * motion, 0.0);
    uv_b = centered / sweep_overscan + 0.5 - vec2(sweep_drift + 0.008 * inverse_progress * motion, 0.0);
    tech_displacement = sweep_drift;
  } else {
    // ORBIT WARP: 对旋轨道相机
    float radial = length(centered * vec2(aspect, 1.0)) / max(0.5, length(vec2(0.5 * aspect, 0.5)));
    float angle = atan(centered.y, centered.x);
    float orbit_wave = sin(angle * 3.0 + u_time * 0.85) * 0.075 * motion;
    float orbit_radius = radial + orbit_wave + (broad_noise - 0.5) * 0.11 * motion;
    float boundary = mix(-0.06, 1.16, u_progress);
    edge = 1.0 - smoothstep(0.018, 0.11, abs(orbit_radius - boundary));
    mask = 1.0 - smoothstep(boundary - 0.04, boundary + 0.06, orbit_radius);
    float rotation_a = 0.24 * u_progress * motion;
    float rotation_b = -0.28 * inverse_progress * motion;
    mat2 rotate_a = mat2(cos(rotation_a), -sin(rotation_a), sin(rotation_a), cos(rotation_a));
    mat2 rotate_b = mat2(cos(rotation_b), -sin(rotation_b), sin(rotation_b), cos(rotation_b));
    uv_a = rotate_a * centered / (1.0 + 0.12 * u_progress) + 0.5;
    uv_b = rotate_b * centered / (1.16 - 0.16 * u_progress) + 0.5;
    tech_displacement = (fine_noise - 0.5) * edge * 0.024 * energy;
    uv_a += vec2(tech_displacement, -tech_displacement);
    uv_b -= vec2(tech_displacement, -tech_displacement);
  }

  float dispersion = edge * motion * mix(0.003, 0.011, blue_noise) * energy * quality;
  vec4 sample_a = sampleMedia(u_texture_a, uv_a, v_uv, u_image_size_a, dispersion);
  vec4 sample_b = sampleMedia(u_texture_b, uv_b, v_uv, u_image_size_b, dispersion);
  vec3 color = mix(sample_a.rgb, sample_b.rgb, mask);

  // progress=0 时输出透明，progress>0 时按 mask 透明度混合：
  // mask=1（纯B）→ 不透明，mask=0（纯A）→ 透明（露出 DOM）
  float alpha = mask;

  color += vec3(0.075, 0.095, 0.105) * edge * motion;
  color.r += edge * motion * 0.03 * energy;
  color.b += edge * motion * 0.052 * energy;
  float vignette = smoothstep(1.15, 0.3, distance(v_uv, vec2(0.5)));
  color *= mix(0.94, 1.03, vignette);

  if (u_video_overlay > 0.5) {
    float overlay_alpha = clamp(edge * 0.76 * motion, 0.0, 0.9);
    vec3 overlay_color = mix(vec3(0.78, 0.88, 1.0), color, 0.58);
    gl_FragColor = vec4(mix(color, overlay_color, overlay_alpha), alpha);
  } else {
    gl_FragColor = vec4(color, alpha);
  }
}
`;

// ─── 渲染参数 ───────────────────────────────────────────────

export interface TransitionRenderOptions {
  /** 过渡进度 0~1（0 = 纯 A 画面，1 = 纯 B 画面） */
  progress: number;
  /** 时间戳（毫秒，驱动噪声动画，推荐传 performance.now()） */
  time: number;
  /** 能量值 0.72~1.9，影响位移/色散强度，默认 1 */
  energy?: number;
  /** 镜头模式 0~7，默认 0（ICE CUT） */
  mode?: TransitionMode;
  /** 视频叠加模式（蓝白色调覆盖），默认 false */
  overlayOnly?: boolean;
  /** 视频全帧模式（保留锐度，提高 DPR 上限），默认 false */
  videoFullFrame?: boolean;
  /** 冻结动态源上传（预热帧），默认 false */
  freezeDynamic?: boolean;
}

// ─── WebGL 工具函数 ─────────────────────────────────────────

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(msg || "Shader compile failed");
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram() as WebGLProgram;
  const vert = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(msg || "Program link failed");
  }
  return program;
}

function createTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // 1×1 深色占位
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([12, 16, 18, 255]));
  return tex;
}

// ─── GPU 自动分档 ───────────────────────────────────────────

export function detectQualityTier(): { tier: QualityTier; supported: boolean } {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      return { tier: "low", supported: false };
    }
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
    const isHigh = /RTX|RX 6|RX 7|UHD|Iris|Pro ?[0-9]{2,}|M1|M2|M3|Adreno|Mali|A[0-9]{2,}/i.test(renderer);
    return { tier: isHigh ? "high" : "medium", supported: true };
  } catch {
    return { tier: "low", supported: false };
  }
}

// ─── 主类 ───────────────────────────────────────────────────

export class TransitionRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext | null = null;
  readonly supported: boolean = false;

  /** 当前镜头模式，可直接赋值切换 */
  mode: TransitionMode = TransitionMode.ICE_CUT;
  /** 能量值，影响位移/色散强度 */
  energy = 1;
  /** 视频叠加模式（蓝白色调覆盖） */
  overlayOnly = false;

  private program: WebGLProgram | null = null;
  private textures: WebGLTexture[] = [];
  private mediaSlots: Array<TexImageSource | null> = [null, null];
  private mediaKeys: string[] = ["", ""];
  private imageSizes: number[][] = [
    [1, 1],
    [1, 1]
  ];
  private textureSources: Array<TexImageSource | null> = [null, null];
  private qualityLevel: QualityTier = "high";
  private preserveSharpness = false;

  private qualityProfiles: Record<QualityTier, QualityProfile> = {
    high: { dpr: 1.75, effect: 1 },
    medium: { dpr: 1.25, effect: 0.82 },
    low: { dpr: 1, effect: 0.66 }
  };

  private locations: {
    position: number;
    resolution: WebGLUniformLocation | null;
    imageSizeA: WebGLUniformLocation | null;
    imageSizeB: WebGLUniformLocation | null;
    progress: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    energy: WebGLUniformLocation | null;
    mode: WebGLUniformLocation | null;
    quality: WebGLUniformLocation | null;
    videoOverlay: WebGLUniformLocation | null;
    textureA: WebGLUniformLocation | null;
    textureB: WebGLUniformLocation | null;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, options?: { qualityTier?: QualityTier; autoDetect?: boolean }) {
    this.canvas = canvas;
    try {
      const gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        powerPreference: "high-performance",
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      }) as WebGLRenderingContext | null;
      if (!gl) {
        return;
      }
      this.gl = gl;
      this.program = createProgram(gl);
      this.textures = [createTexture(gl), createTexture(gl)];
      this.locations = {
        position: gl.getAttribLocation(this.program, "a_position"),
        resolution: gl.getUniformLocation(this.program, "u_resolution"),
        imageSizeA: gl.getUniformLocation(this.program, "u_image_size_a"),
        imageSizeB: gl.getUniformLocation(this.program, "u_image_size_b"),
        progress: gl.getUniformLocation(this.program, "u_progress"),
        time: gl.getUniformLocation(this.program, "u_time"),
        energy: gl.getUniformLocation(this.program, "u_energy"),
        mode: gl.getUniformLocation(this.program, "u_mode"),
        quality: gl.getUniformLocation(this.program, "u_quality"),
        videoOverlay: gl.getUniformLocation(this.program, "u_video_overlay"),
        textureA: gl.getUniformLocation(this.program, "u_texture_a"),
        textureB: gl.getUniformLocation(this.program, "u_texture_b")
      };
      // 全屏三角形
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.useProgram(this.program);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(this.locations.textureA, 0);
      gl.uniform1i(this.locations.textureB, 1);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      this.supported = true;

      // 质量档位
      const autoDetect = options?.autoDetect ?? true;
      const tier = options?.qualityTier ?? (autoDetect ? detectQualityTier().tier : "high");
      this.setQuality(tier);
    } catch (err) {
      console.warn("[TransitionRenderer] WebGL unavailable:", (err as Error).message);
      this.supported = false;
    }
  }

  // ─── 媒体设置 ─────────────────────────────────────────────

  /**
   * 设置 A 画面（起始页）。接受 HTMLImageElement / HTMLVideoElement / HTMLCanvasElement。
   * 传入 null 清除。
   */
  setMediaA(media: TexImageSource | null, key?: string): void {
    this.setMedia(0, media, key);
  }

  /**
   * 设置 B 画面（目标页）。
   */
  setMediaB(media: TexImageSource | null, key?: string): void {
    this.setMedia(1, media, key);
  }

  /** 同时设置 A/B 两路媒体 */
  setMediaPair(mediaA: TexImageSource | null, mediaB: TexImageSource | null, keyA?: string, keyB?: string): void {
    this.setMedia(0, mediaA, keyA);
    this.setMedia(1, mediaB, keyB);
  }

  private setMedia(slot: 0 | 1, media: TexImageSource | null, key?: string): void {
    this.mediaSlots[slot] = media;
    this.mediaKeys[slot] = key ?? "";
    // 强制下次 upload 重新分配
    this.textureSources[slot] = null;
  }

  // ─── 质量档位 ─────────────────────────────────────────────

  setQuality(tier: QualityTier): void {
    this.qualityLevel = tier;
  }

  getQuality(): QualityTier {
    return this.qualityLevel;
  }

  // ─── 尺寸 ─────────────────────────────────────────────────

  /** 根据 canvas 的 CSS 尺寸 + DPR 设置 drawing buffer，需在 render 前调用 */
  resize(preserveSharpness = false): void {
    if (!this.supported || !this.gl) {
      return;
    }
    this.preserveSharpness = preserveSharpness;
    const dprLimit = preserveSharpness ? 2 : this.qualityProfiles[this.qualityLevel].dpr;
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, dprLimit));
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width === w && this.canvas.height === h) {
      return;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  // ─── 渲染 ─────────────────────────────────────────────────

  /**
   * 上传一帧并渲染。
   *
   * @param options.progress  过渡进度 0~1
   * @param options.time      时间戳（毫秒），驱动噪声动画
   * @param options.energy    能量值（可选，默认取 this.energy）
   * @param options.mode      镜头模式（可选，默认取 this.mode）
   * @param options.overlayOnly  视频叠加模式（可选，默认取 this.overlayOnly）
   * @param options.videoFullFrame  视频全帧模式（可选，默认 false）
   * @param options.freezeDynamic   冻结动态源（可选，默认 false）
   * @returns 是否渲染成功
   */
  render(options: TransitionRenderOptions): boolean;
  render(progress: number, time: number): boolean;
  render(optionsOrProgress: TransitionRenderOptions | number, timeOrUndefined?: number): boolean {
    if (!this.supported) {
      return false;
    }

    const opts: TransitionRenderOptions =
      typeof optionsOrProgress === "number"
        ? { progress: optionsOrProgress, time: timeOrUndefined ?? 0 }
        : optionsOrProgress;

    const gl = this.gl;
    if (!gl || !this.program || !this.locations) {
      return false;
    }

    const videoFullFrame = opts.videoFullFrame ?? false;
    this.resize(videoFullFrame);

    // 上传纹理
    if (!this.upload(0, opts.freezeDynamic ?? false) || !this.upload(1, opts.freezeDynamic ?? false)) {
      return false;
    }

    const progress = Math.max(0, Math.min(1, opts.progress));
    const energy = opts.energy ?? this.energy;
    const mode = opts.mode ?? this.mode;
    const overlayOnly = opts.overlayOnly ?? this.overlayOnly;

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);

    const loc = this.locations;
    gl.uniform2f(loc.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(loc.imageSizeA, this.imageSizes[0][0], this.imageSizes[0][1]);
    gl.uniform2f(loc.imageSizeB, this.imageSizes[1][0], this.imageSizes[1][1]);
    gl.uniform1f(loc.progress, progress);
    gl.uniform1f(loc.time, opts.time * 0.001);
    gl.uniform1f(loc.energy, energy);
    gl.uniform1f(loc.mode, mode);
    gl.uniform1f(loc.quality, this.qualityProfiles[this.qualityLevel].effect);
    gl.uniform1f(loc.videoOverlay, overlayOnly ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }

  // ─── 纹理上传 ─────────────────────────────────────────────

  private upload(slot: 0 | 1, freezeDynamic: boolean): boolean {
    const media = this.mediaSlots[slot];
    if (!media) {
      return false;
    }

    const isVideo = (media as HTMLMediaElement)?.tagName === "VIDEO";
    const isCanvas = (media as HTMLCanvasElement)?.tagName === "CANVAS";
    const isImage = (media as HTMLImageElement)?.tagName === "IMG";
    const isDynamic = isVideo || isCanvas;

    const videoEl = media as HTMLVideoElement;
    const canvasEl = media as HTMLCanvasElement;
    const imageEl = media as HTMLImageElement;

    const width = isVideo ? videoEl.videoWidth : isCanvas ? canvasEl.width : imageEl.naturalWidth || imageEl.width;
    const height = isVideo ? videoEl.videoHeight : isCanvas ? canvasEl.height : imageEl.naturalHeight || imageEl.height;

    const ready = isVideo
      ? (videoEl.readyState ?? 0) >= 2
      : isImage
        ? (imageEl.complete ?? false)
        : (width ?? 0) > 0 && (height ?? 0) > 0;

    if (!ready || !width || !height) {
      return false;
    }

    const gl = this.gl;
    if (!gl) {
      return false;
    }

    const dimensionsChanged = this.imageSizes[slot][0] !== width || this.imageSizes[slot][1] !== height;
    const sourceChanged = this.textureSources[slot] !== media;
    const keyChanged = this.mediaKeys[slot] !== "" && this.textureSources[slot] === media;
    const needsAllocation = dimensionsChanged || sourceChanged || keyChanged;

    // 静态媒体且无变化 → 跳过
    if (!isDynamic && !needsAllocation) {
      return true;
    }
    // 动态媒体冻结 → 跳过
    if (isDynamic && freezeDynamic && !needsAllocation) {
      return true;
    }

    try {
      gl.activeTexture(slot === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (needsAllocation) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media as TexImageSource);
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, media as TexImageSource);
      }
      this.textureSources[slot] = media;
      this.imageSizes[slot] = [width, height];
      return true;
    } catch (err) {
      console.warn("[TransitionRenderer] texture upload failed:", (err as Error).message);
      this.textureSources[slot] = null;
      return false;
    }
  }

  // ─── 预热 ─────────────────────────────────────────────────

  /**
   * 预热渲染：用当前媒体做一次 progress=0 的静态渲染，
   * 强制 GPU 编译着色器 + 分配纹理，消除首次转场卡顿。
   */
  warm(mode?: TransitionMode): void {
    if (!this.supported) {
      return;
    }
    const prevMode = this.mode;
    if (mode !== undefined) {
      this.mode = mode;
    }
    this.render({ progress: 0, time: 0, freezeDynamic: true });
    this.mode = prevMode;
  }

  // ─── 清理 ─────────────────────────────────────────────────

  /** 清除纹理缓存，下次 render 强制重新上传 */
  invalidate(): void {
    this.textureSources = [null, null];
  }

  /** 销毁 WebGL 资源 */
  dispose(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
    }
    this.textures.forEach((t) => t && gl.deleteTexture(t));
    this.program = null;
    this.textures = [];
    this.locations = null;
    this.mediaSlots = [null, null];
    this.textureSources = [null, null];
  }
}
