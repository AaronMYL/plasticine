// 队友头像（11-13 Aaron 定）：头像是 Plasticine-bot 的一个角色加八色里的一种，不再是头像文字。这里是角色的 id
// 清单（和打包进来的引擎 SHAPE_IDS 一致，client 的测试核对两边），服务端校验、迁移和自动分配都看它。

/** 引擎里全部 71 个角色，按引擎的家族顺序。 */
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

/** 新建队友时先放这一个，挑了再换。 */
export const DEFAULT_MATE_CHARACTER: MateCharacter = 'mochi';

/**
 * 没挑过的（旧的头像文字、整理旧对话建出来的）按名字自动分：从轮廓一眼分得开的这些里挑，同一个名字总是同一个。
 * 分好就存进库里，以后改这份清单不影响已经分好的。
 */
export const AUTO_MATE_CHARACTERS: readonly MateCharacter[] = [
  'cat', 'bunny', 'bear', 'chick', 'penguin', 'fox', 'hamster', 'koala', 'seal', 'octopus', 'fish', 'ghost',
  'bot', 'mushroom', 'cactus', 'strawberry', 'avocado', 'boba', 'cloud', 'star', 'bell', 'planet', 'pig', 'hedgehog',
];

export function isMateCharacter(value: unknown): value is MateCharacter {
  return typeof value === 'string' && (MATE_CHARACTERS as readonly string[]).includes(value);
}

/** FNV-1a 32 位：按名字固定分一个角色。 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** 按名字分一个；taken 里是别的队友已经用了的，顺着往后找一个没人用的（都用了就不管重不重）。 */
export function autoMateCharacter(seed: string, taken: ReadonlySet<string> = new Set()): MateCharacter {
  const start = hash(seed) % AUTO_MATE_CHARACTERS.length;
  for (let step = 0; step < AUTO_MATE_CHARACTERS.length; step += 1) {
    const pick = AUTO_MATE_CHARACTERS[(start + step) % AUTO_MATE_CHARACTERS.length];
    if (pick !== undefined && !taken.has(pick)) return pick;
  }
  return AUTO_MATE_CHARACTERS[start] ?? DEFAULT_MATE_CHARACTER;
}

/**
 * 画风和脸型（11-13 Aaron 定）：角色之外还能换引擎的 16 种矢量画风（不要像素和颜文字，它们不跟颜色令牌）和 16 种脸型。
 * 顺序和打包进来的引擎 VECTOR_VARIANTS、FACE_STYLES 一致，client 的测试核对两边。主线也能换画风，脸固定是漩涡。
 */
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
