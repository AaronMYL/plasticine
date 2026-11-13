// 大家伙（追的那一个）从上往下看的样子：沿一根脊柱的半宽曲线，加上鳍、翅膀这些「肢」，再加尾巴和花纹。
// 鲨鱼的做法和数值照 ascii-sharks（MIT，见 NOTICE.md）；其余的形象按同一套写。

/** 颜色从令牌里取：ink / muted / faint 是字的三档，其余是 --hue-*。 */
export const TONES = ['ink', 'muted', 'faint', 'slate', 'sky', 'teal', 'clay', 'ochre', 'olive', 'sage', 'indigo',
  'rose', 'plum'] as const;
export type Tone = (typeof TONES)[number];

export interface Limb {
  /** 根部前后两点、尖端沿身体的位置、伸出去多远，都按身长算；尖端可以在吻端前面（负数，蝠鲼的头鳍）。 */
  root0: number;
  root1: number;
  tip: number;
  reach: number;
  /** 镰刀形后缘（鲨鱼的胸鳍）。 */
  falcate?: boolean;
  /** 扇动：伸出去的长度随拍子缩短（从上往下看，翅膀抬起、压下都显短）。 */
  flap?: number;
}

/** fork：鲨鱼的叉尾；fluke：鲸的横尾叶；fan：鸟的扇尾。from 是尾巴开始的位置。 */
export interface Tail {
  kind: 'fork' | 'fluke' | 'fan';
  reach: number;
  from: number;
}

export type MarkKind = 'none' | 'circuit' | 'feathers';

export interface Glyphs {
  /** 从亮到暗（从疏到密）。 */
  skin: string;
  fin: string;
  ridge: string;
  mark: string;
  eye: string;
  edgeHeavy: string;
  edgeLight: string;
}

export interface Motion {
  /** 巡游速度的倍数。 */
  cruise: number;
  /** 有多想追：0 只巡游，1 鲨鱼那样。 */
  hunt: number;
  /** 转弯灵活的倍数。 */
  agility: number;
  /** 身长的倍数（龙、蛇更长）。 */
  size: number;
}

export interface BodyDef {
  nodes: number;
  /** 每节最多弯多少（弧度），身体最多弯成 C，不会折回去。 */
  maxBend: number;
  /** 半宽，按身长算；s 从吻端 0 到尾尖 1；beat 是 -1..1 的拍子（蝠鲼扇翼）。 */
  halfWidth: (s: number, beat: number) => number;
  limbs: readonly Limb[];
  tail: Tail | null;
  /** 锤头鲨的头翼：半展、尖端往后掠、厚度、前缘中间的凹口。 */
  head?: { span: number; sweep: number; depth: number; notch: number };
  dorsal: readonly [number, number] | null;
  /** 背鳍在横向多宽的范围里（占半宽的比例）。 */
  dorsalWidth: number;
  secondDorsal: readonly [number, number] | null;
  eye: readonly [number, number] | null;
  eyeAcross: number;
  gills: readonly [number, number] | null;
  marks: MarkKind;
  /** 游动时身体的横波：幅度（按身长）和一条身体上有几段。 */
  wave: number;
  waveLength: number;
  glyphs: Glyphs;
  tone: Tone;
  /** 偶尔闪一下的颜色。 */
  accent: Tone;
  /** 花纹的颜色；没写就和身体一样。 */
  markTone?: Tone;
  motion: Motion;
}

export const SHARK_GLYPHS: Glyphs = {
  skin: ':;t%SX8#@',
  fin: '%;tS:',
  ridge: '@8%',
  mark: '#%@',
  eye: 'o',
  edgeHeavy: ':;',
  edgeLight: ".',`",
};
