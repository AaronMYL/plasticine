// 打包进来的角色引擎（engine.js）里界面用到的那几样的类型；只写用到的字段。导出清单见
// scripts/vendor-plasticine-bot.ts 的 ENGINE_EXPORTS，两边一起改。

export type Point = readonly [number, number];

export type InkPaint = { flat: string };

export interface CharacterOptions {
  shape?: string;
  state?: string;
  face?: string;
  variant?: string;
  seed?: string;
  ink?: InkPaint | null;
  reducedMotion?: boolean;
  entryEffects?: boolean;
  antics?: boolean;
  autoPause?: boolean;
}

export interface CharacterController {
  update(options: Partial<CharacterOptions>): void;
  spin(turns?: number): void;
  bounce(strength?: number): void;
  burst(count?: number): void;
  settle(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
  readonly element: SVGSVGElement;
  readonly paused: boolean;
}

export function createCharacter(host: Element, options?: CharacterOptions): CharacterController;

export interface StaticOptions {
  shape?: string;
  state?: string;
  face?: string;
  variant?: string;
  sizePx?: number;
  ink?: InkPaint | null;
  eyeColor?: string;
  colorScheme?: 'system' | 'page';
}

export function renderStaticSvg(options?: StaticOptions): string;

export function defineShape(id: string, outline: () => Point[], options?: { faceHint?: Point }): unknown;

/** 一只眼的读法：引擎把可爱脸的每种表情读成这几样，画别的脸时照着改自己的数。 */
export interface EyeReading {
  kind: 'open' | 'smile' | 'closed' | 'mad' | 'sad' | 'cross' | 'star';
  open: number;
  size: number;
  off: Point;
}

export interface EyeContext {
  nose: 1 | -1;
  order: 0 | 1;
  time: number;
  settled: boolean;
  blink: number;
  look: Point;
  weight: number;
  mid: number;
}

export interface FaceLayer {
  paint: string;
  rings: Point[][];
  opacity: number;
}

export type DrawnEye = Readonly<Record<string, number>>;
export type DrawnPair = readonly [DrawnEye, DrawnEye];

export interface FaceDesign {
  id: string;
  layout: {
    lift: number;
    separation: number;
    minSeparation: number;
    mouthDrop: number;
    mouthScale: number;
    mouthWeight: number;
    blush: { x: number; y: number };
    gazeShift: number;
  };
  expressions: Record<string, DrawnPair>;
  classes: Record<string, readonly [string, string]>;
  states: Record<string, readonly string[]>;
  mouths: Record<string, unknown>;
  stateMouth: Record<string, string>;
  mouthPaint: string;
  quietFx: readonly string[];
  kaomoji: { eyes: Record<string, string>; mouths: Record<string, string> };
  eye(spec: DrawnEye, ctx: EyeContext): FaceLayer[];
  plate?(left: DrawnEye, right: DrawnEye, ctx: EyeContext): FaceLayer[];
}

export function defineFace(design: FaceDesign, options?: { label?: { en: string; zh: string } }): void;

export interface LayerListInstance {
  readonly layers: FaceLayer[];
  add(paint: string, rings: readonly (Point[] | null | undefined)[], opacity?: number): void;
}

export const FACE_KIT: {
  circleRing(cx: number, cy: number, r: number, n?: number): Point[];
  vocabulary(rest: DrawnEye, form: (reading: EyeReading) => Partial<Record<string, number>>): Record<string, DrawnPair>;
  LayerList: new () => LayerListInstance;
};

export const STATE_CUTE_EYES: Record<string, readonly string[]>;
export const STATE_CUTE_MOUTH: Record<string, string>;
export const CUTE_MOUTHS: Record<string, unknown>;
export const SHAPE_IDS: readonly string[];
export const SHAPE_FAMILIES: readonly { id: string; label: { en: string; zh: string }; shapes: readonly string[] }[];
/** 矢量画风（扁平、线条、玻璃……），按引擎的顺序。 */
export const VECTOR_VARIANTS: readonly string[];
/** 全部脸型（胶囊眼、萌脸、豆豆眼……），按引擎的顺序。 */
export const FACE_STYLES: readonly string[];
