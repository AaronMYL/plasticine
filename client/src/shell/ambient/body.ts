export const TONES = ['ink', 'muted', 'faint', 'slate', 'sky', 'teal', 'clay', 'ochre', 'olive', 'sage', 'indigo',
  'rose', 'plum'] as const;
export type Tone = (typeof TONES)[number];

export interface Limb {
  root0: number;
  root1: number;
  tip: number;
  reach: number;
  falcate?: boolean;
  flap?: number;
}

export interface Tail {
  kind: 'fork' | 'fluke' | 'fan';
  reach: number;
  from: number;
}

export type MarkKind = 'none' | 'circuit' | 'feathers';

export interface Glyphs {
  skin: string;
  fin: string;
  ridge: string;
  mark: string;
  eye: string;
  edgeHeavy: string;
  edgeLight: string;
}

export interface Motion {
  cruise: number;
  hunt: number;
  agility: number;
  size: number;
}

export interface BodyDef {
  nodes: number;
  maxBend: number;
  halfWidth: (s: number, beat: number) => number;
  limbs: readonly Limb[];
  tail: Tail | null;
  head?: { span: number; sweep: number; depth: number; notch: number };
  dorsal: readonly [number, number] | null;
  dorsalWidth: number;
  secondDorsal: readonly [number, number] | null;
  eye: readonly [number, number] | null;
  eyeAcross: number;
  gills: readonly [number, number] | null;
  marks: MarkKind;
  wave: number;
  waveLength: number;
  glyphs: Glyphs;
  tone: Tone;
  accent: Tone;
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
