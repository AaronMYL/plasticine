export const PREY_KINDS = ['fish', 'birds', 'bugs', 'bits'] as const;
export type PreyKind = (typeof PREY_KINDS)[number];

export interface Species {
  cruise: number;
  maxSpeed: number;
  minSpeed: number;
  weight: number;
  schoolSize: readonly [number, number];
  spacing: readonly [number, number];
  align: number;
  cohesion: number;
  jitter: number;
  mill: number;
  verticalDrag: number;
  glyphs: string;
}

const FISH: readonly Species[] = [
  { cruise: 36, maxSpeed: 64, minSpeed: 18, weight: 3, schoolSize: [18, 28], spacing: [1.8, 1.1],
    align: 1.6, cohesion: 1.6, jitter: 40, mill: 70, verticalDrag: 0.5, glyphs: '-' },
  { cruise: 46, maxSpeed: 78, minSpeed: 22, weight: 3, schoolSize: [20, 32], spacing: [1.5, 1],
    align: 3.2, cohesion: 0.45, jitter: 30, mill: 0, verticalDrag: 1.4, glyphs: '-' },
  { cruise: 40, maxSpeed: 70, minSpeed: 20, weight: 3, schoolSize: [12, 20], spacing: [2, 1.1],
    align: 2.4, cohesion: 1.1, jitter: 35, mill: 0, verticalDrag: 1.6, glyphs: '-' },
  { cruise: 32, maxSpeed: 60, minSpeed: 16, weight: 2, schoolSize: [5, 9], spacing: [2.6, 1.3],
    align: 2, cohesion: 0.9, jitter: 25, mill: 0, verticalDrag: 2, glyphs: '=' },
  { cruise: 26, maxSpeed: 56, minSpeed: 10, weight: 1, schoolSize: [8, 12], spacing: [1.4, 1.1],
    align: 0.35, cohesion: 1.4, jitter: 110, mill: 0, verticalDrag: 0.3, glyphs: '-' },
];

const BIRDS: readonly Species[] = [
  { cruise: 64, maxSpeed: 118, minSpeed: 38, weight: 3, schoolSize: [34, 54], spacing: [1.6, 1.1],
    align: 3, cohesion: 1.3, jitter: 24, mill: 46, verticalDrag: 0, glyphs: 'v-' },
  { cruise: 82, maxSpeed: 140, minSpeed: 48, weight: 1, schoolSize: [6, 10], spacing: [2.4, 1.4],
    align: 1.1, cohesion: 0.8, jitter: 90, mill: 0, verticalDrag: 0.2, glyphs: 'v^' },
];

const BUGS: readonly Species[] = [
  { cruise: 22, maxSpeed: 52, minSpeed: 6, weight: 3, schoolSize: [10, 18], spacing: [1.4, 1],
    align: 2.6, cohesion: 0.6, jitter: 60, mill: 0, verticalDrag: 0, glyphs: '.:' },
  { cruise: 16, maxSpeed: 44, minSpeed: 4, weight: 1, schoolSize: [3, 6], spacing: [2.2, 1.4],
    align: 0.4, cohesion: 0.6, jitter: 120, mill: 0, verticalDrag: 0, glyphs: 'o' },
  { cruise: 28, maxSpeed: 96, minSpeed: 8, weight: 1, schoolSize: [2, 4], spacing: [3, 1.6],
    align: 0.3, cohesion: 0.5, jitter: 150, mill: 0, verticalDrag: 0, glyphs: '~' },
];

const BITS: readonly Species[] = [
  { cruise: 52, maxSpeed: 92, minSpeed: 30, weight: 3, schoolSize: [12, 20], spacing: [1.4, 1],
    align: 3.4, cohesion: 0.5, jitter: 10, mill: 0, verticalDrag: 1.8, glyphs: '01' },
  { cruise: 36, maxSpeed: 70, minSpeed: 14, weight: 2, schoolSize: [16, 26], spacing: [1.3, 1],
    align: 1, cohesion: 1.8, jitter: 30, mill: 90, verticalDrag: 0.4, glyphs: '10' },
];

export const SPECIES: Readonly<Record<PreyKind, readonly Species[]>> = {
  fish: FISH, birds: BIRDS, bugs: BUGS, bits: BITS,
};

export function pickSpecies(list: readonly Species[]): number {
  const total = list.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= list[i]!.weight;
    if (r <= 0) return i;
  }
  return 0;
}
