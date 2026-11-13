// 各个形象的身体。鲨鱼、锤头鲨的曲线和鳍的位置照 ascii-sharks（MIT，见 NOTICE.md），其余按同一套写：半宽曲线画轮廓，
// 鳍、翅膀是贴在两侧的三角形，花纹和字各自一套。

import { SHARK_GLYPHS, type BodyDef } from './body.ts';
import { smoothstep } from './math.ts';

/** 经典鲨鱼的半宽（按身长）。 */
function sharkHalfWidth(s: number): number {
  if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
  if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
  const k = (s - 0.84) / 0.16;
  return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

const SHARK_BASE = {
  nodes: 20,
  maxBend: 0.16,
  dorsalWidth: 0.3,
  eyeAcross: 0.6,
  wave: 0.05,
  waveLength: 5.2,
} as const;

const shark: BodyDef = {
  ...SHARK_BASE,
  halfWidth: sharkHalfWidth,
  limbs: [
    { root0: 0.15, root1: 0.43, tip: 0.55, reach: 0.26, falcate: true },
    { root0: 0.57, root1: 0.65, tip: 0.69, reach: 0.085 },
  ],
  tail: { kind: 'fork', reach: 0.085, from: 0.86 },
  dorsal: [0.33, 0.47],
  secondDorsal: [0.71, 0.76],
  eye: [0.1, 0.14],
  gills: [0.19, 0.29],
  marks: 'none',
  glyphs: SHARK_GLYPHS,
  tone: 'slate',
  accent: 'sky',
  motion: { cruise: 1, hunt: 1, agility: 1, size: 1 },
};

const hammerhead: BodyDef = {
  ...SHARK_BASE,
  halfWidth: (s) => {
    if (s < 0.06) return 0.045;
    if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
    return sharkHalfWidth(s) * 0.92;
  },
  head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
  limbs: [
    { root0: 0.17, root1: 0.4, tip: 0.5, reach: 0.22, falcate: true },
    { root0: 0.56, root1: 0.63, tip: 0.67, reach: 0.075 },
  ],
  tail: { kind: 'fork', reach: 0.11, from: 0.86 },
  dorsal: [0.28, 0.44],
  secondDorsal: [0.7, 0.74],
  eye: null,
  gills: [0.16, 0.26],
  marks: 'none',
  glyphs: SHARK_GLYPHS,
  tone: 'olive',
  accent: 'ochre',
  motion: { cruise: 1, hunt: 1, agility: 1, size: 1 },
};

/** 大锤头鲨：更宽、几乎平直的头翼，中间一个凹口，背鳍又高又长。 */
const greatHammer: BodyDef = {
  ...hammerhead,
  halfWidth: (s) => {
    if (s < 0.05) return 0.04;
    if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
    return sharkHalfWidth(s) * 0.95;
  },
  head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
  limbs: [
    { root0: 0.16, root1: 0.38, tip: 0.49, reach: 0.24, falcate: true },
    { root0: 0.55, root1: 0.62, tip: 0.67, reach: 0.085 },
  ],
  tail: { kind: 'fork', reach: 0.13, from: 0.86 },
  dorsal: [0.24, 0.45],
  secondDorsal: [0.68, 0.74],
  gills: [0.15, 0.25],
  tone: 'slate',
};

/** 机械鲨：同一副鲨鱼骨架，皮换成线路板。 */
const mech: BodyDef = {
  ...shark,
  marks: 'circuit',
  glyphs: { skin: ':=+|#H', fin: '/\\|=', ridge: '#H', mark: '+=', eye: '@', edgeHeavy: ':|', edgeLight: '.`' },
  tone: 'indigo',
  accent: 'teal',
  markTone: 'teal',
};

const whale: BodyDef = {
  nodes: 22,
  maxBend: 0.12,
  halfWidth: (s) => {
    if (s < 0.12) return 0.1 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.5);
    if (s < 0.35) return 0.1 + 0.02 * smoothstep(0.12, 0.35, s);
    if (s < 0.86) return 0.016 + 0.104 * Math.pow(1 - (s - 0.35) / 0.51, 1.3);
    const k = (s - 0.86) / 0.14;
    return 0.016 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
  },
  limbs: [{ root0: 0.2, root1: 0.3, tip: 0.47, reach: 0.3 }],
  tail: { kind: 'fluke', reach: 0.19, from: 0.87 },
  dorsal: [0.62, 0.66],
  dorsalWidth: 0.25,
  secondDorsal: null,
  eye: [0.1, 0.13],
  eyeAcross: 0.85,
  gills: null,
  marks: 'none',
  wave: 0.03,
  waveLength: 4,
  glyphs: SHARK_GLYPHS,
  tone: 'slate',
  accent: 'sky',
  motion: { cruise: 0.55, hunt: 0.15, agility: 0.55, size: 1.3 },
};

/** 蝠鲼：前面一对头鳍，两翼又宽又薄，后面一根细尾巴；从上看，翅膀扇上去、压下来都显短。 */
const manta: BodyDef = {
  nodes: 18,
  maxBend: 0.1,
  halfWidth: (s, beat) => {
    const span = 0.5 * (1 - 0.28 * beat * beat);
    if (s < 0.05) return 0.085;
    if (s < 0.22) return 0.085 + (span - 0.085) * Math.pow((s - 0.05) / 0.17, 0.8);
    if (s < 0.42) return 0.045 + (span - 0.045) * Math.pow(1 - (s - 0.22) / 0.2, 1.7);
    if (s < 0.46) return 0.045 * (1 - (s - 0.42) / 0.04) + 0.006;
    return 0.006 * (1 - (s - 0.46) / 0.54) + 0.0015;
  },
  limbs: [{ root0: 0, root1: 0.035, tip: -0.035, reach: 0.07 }],
  tail: null,
  dorsal: null,
  dorsalWidth: 0.3,
  secondDorsal: null,
  eye: [0.035, 0.07],
  eyeAcross: 0.86,
  gills: null,
  marks: 'none',
  wave: 0.012,
  waveLength: 2,
  glyphs: SHARK_GLYPHS,
  tone: 'ink',
  accent: 'sky',
  motion: { cruise: 0.7, hunt: 0, agility: 0.7, size: 0.9 },
};

const hawk: BodyDef = {
  nodes: 16,
  maxBend: 0.12,
  halfWidth: (s) => {
    if (s < 0.08) return 0.05 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.6);
    if (s < 0.14) return 0.05 - 0.01 * smoothstep(0.08, 0.14, s);
    if (s < 0.45) return 0.04 + 0.035 * Math.sin(((s - 0.14) / 0.31) * Math.PI);
    if (s < 0.62) return 0.04 * (1 - (s - 0.45) / 0.17) + 0.02;
    return 0.02;
  },
  limbs: [
    { root0: 0.16, root1: 0.42, tip: 0.34, reach: 0.4, flap: 0.4 },
    { root0: 0.22, root1: 0.38, tip: 0.45, reach: 0.64, flap: 0.4 },
  ],
  tail: { kind: 'fan', reach: 0.13, from: 0.6 },
  dorsal: null,
  dorsalWidth: 0.3,
  secondDorsal: null,
  eye: [0.025, 0.05],
  eyeAcross: 0.6,
  gills: null,
  marks: 'feathers',
  wave: 0.006,
  waveLength: 2,
  glyphs: { skin: ':;=+*%#@', fin: '=/%#', ridge: '^', mark: '-~', eye: 'o', edgeHeavy: ':;', edgeLight: ".'`" },
  tone: 'ochre',
  accent: 'clay',
  motion: { cruise: 1.7, hunt: 1, agility: 1.5, size: 0.8 },
};

export const BODIES = {
  shark, hammerhead, greatHammer, mech, whale, manta, hawk,
} as const satisfies Record<string, BodyDef>;
export type BodyId = keyof typeof BODIES;
