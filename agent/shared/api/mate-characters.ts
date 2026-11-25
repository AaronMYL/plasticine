export const MATE_CHARACTERS = [
  'circle', 'mochi', 'blob', 'pebble', 'egg', 'bun',
  'tofu', 'pill',
  'hex', 'onigiri', 'gem',
  'cloud', 'drop', 'leaf', 'flower', 'clover',
  'sprout', 'mushroom', 'acorn', 'cactus', 'eggplant',
  'pear', 'apple', 'strawberry', 'cherry', 'avocado', 'melon',
  'pudding', 'toast', 'icecream', 'cupcake', 'fries', 'candy', 'burger',
  'star', 'heart', 'flame', 'bell', 'ghost', 'bot', 'crescent', 'boba', 'planet',
  'cottage', 'chat', 'gift', 'bulb',
  'fish', 'octopus', 'seal', 'puffer',
  'cat', 'bunny', 'bear', 'chick', 'penguin', 'pig', 'fox', 'lion', 'hamster', 'hedgehog', 'koala', 'bat',
  'bob', 'topknot', 'spiky', 'curly', 'twinbuns',
  'chunk', 'lump', 'fluff',
] as const;
export type MateCharacter = (typeof MATE_CHARACTERS)[number];

export const DEFAULT_MATE_CHARACTER: MateCharacter = 'mochi';

export const AUTO_MATE_CHARACTERS: readonly MateCharacter[] = [
  'cat', 'bunny', 'bear', 'chick', 'penguin', 'fox', 'hamster', 'koala', 'seal', 'octopus', 'fish', 'ghost',
  'bot', 'mushroom', 'cactus', 'strawberry', 'avocado', 'boba', 'cloud', 'star', 'bell', 'planet', 'pig', 'hedgehog',
];

export function isMateCharacter(value: unknown): value is MateCharacter {
  return typeof value === 'string' && (MATE_CHARACTERS as readonly string[]).includes(value);
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function autoMateCharacter(seed: string, taken: ReadonlySet<string> = new Set()): MateCharacter {
  const start = hash(seed) % AUTO_MATE_CHARACTERS.length;
  for (let step = 0; step < AUTO_MATE_CHARACTERS.length; step += 1) {
    const pick = AUTO_MATE_CHARACTERS[(start + step) % AUTO_MATE_CHARACTERS.length];
    if (pick !== undefined && !taken.has(pick)) return pick;
  }
  return AUTO_MATE_CHARACTERS[start] ?? DEFAULT_MATE_CHARACTER;
}

export const MATE_VARIANTS = [
  'solid', 'outline', 'glass', 'sticker', 'paper', 'soft', 'riso', 'pencil',
  'marker', 'crayon', 'watercolor', 'neon', 'chalk', 'origami', 'relief', 'gothic',
] as const;
export type MateVariant = (typeof MATE_VARIANTS)[number];
export const DEFAULT_MATE_VARIANT: MateVariant = 'solid';

export const MATE_FACES = [
  'capsule', 'cute', 'eyes', 'line', 'brow', 'glossy', 'sparkle', 'button',
  'shades', 'droopy', 'bigmouth', 'pie', 'screen', 'symbol', 'teardrop', 'specs',
] as const;
export type MateFace = (typeof MATE_FACES)[number];
export const DEFAULT_MATE_FACE: MateFace = 'cute';
