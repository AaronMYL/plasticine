// 阅读页记在这台设备上的几样：字号和行距、阅读方式（翻页 / 滚动）、某本书「在原文里标出」重点开没开、这台设备上读到哪。
// 都放 localStorage；浏览器不让存（隐私模式、存满了）时照样能读，只是下次不记得，写一条警告不打断阅读。

export interface Typography {
  /** 字号档位：TYPE_SIZES 的下标。 */
  size: number;
  /** 行距档位：TYPE_LEADINGS 的下标。 */
  leading: number;
}

/** 正文字号五档；电脑默认 16（笔记长文 16/28），手机默认 17（设计稿 17/30）。 */
export const TYPE_SIZES = [15, 16, 17, 18, 20] as const;
/** 行距三档，按字号的倍数：紧凑 / 适中 / 宽松。适中 1.75 即 16/28。 */
export const TYPE_LEADINGS = [
  { label: '紧凑', ratio: 1.6 },
  { label: '适中', ratio: 1.75 },
  { label: '宽松', ratio: 1.9 },
] as const;

export const DESKTOP_TYPOGRAPHY: Typography = { size: 1, leading: 1 };
export const PHONE_TYPOGRAPHY: Typography = { size: 2, leading: 1 };

/** 阅读方式（第 7 批第 3 条，他定）：默认左右翻页、一次一页；「Aa」里能切回上下滚。 */
export type ReadingMode = 'paged' | 'scroll';
export const READING_MODES: ReadonlyArray<{ mode: ReadingMode; label: string }> = [
  { mode: 'paged', label: '翻页' },
  { mode: 'scroll', label: '滚动' },
];

const TYPOGRAPHY_KEY = 'plasticine.books.typography';
const MODE_KEY = 'plasticine.books.mode';
const KEY_POINTS_KEY = 'plasticine.books.key-points.';
const POSITION_KEY = 'plasticine.books.position.';

export interface LocalPosition {
  chapter: number;
  offset: number;
  percent: number;
  /** 这台设备上最后一次记下的时间（ISO）：和服务端别的设备记的比先后。 */
  savedAt: string;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn('这台设备的阅读设置读不到，先用默认的。', error);
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn('这台设备的阅读设置没存上，下次打开会回到默认。', error);
  }
}

function parsed(raw: string | null): unknown {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function isIndex(value: unknown, length: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length;
}

export function loadTypography(phone: boolean): Typography {
  const value = parsed(read(TYPOGRAPHY_KEY));
  if (typeof value === 'object' && value !== null && 'size' in value && 'leading' in value
    && isIndex(value.size, TYPE_SIZES.length) && isIndex(value.leading, TYPE_LEADINGS.length)) {
    return { size: value.size, leading: value.leading };
  }
  return phone ? PHONE_TYPOGRAPHY : DESKTOP_TYPOGRAPHY;
}

export function saveTypography(typography: Typography): void {
  write(TYPOGRAPHY_KEY, JSON.stringify(typography));
}

export function loadReadingMode(): ReadingMode {
  return read(MODE_KEY) === 'scroll' ? 'scroll' : 'paged';
}

export function saveReadingMode(mode: ReadingMode): void {
  write(MODE_KEY, mode);
}

/** 字号和行高（px）。 */
export function typeMetrics(typography: Typography): { fontSize: number; lineHeight: number } {
  const fontSize = TYPE_SIZES[typography.size] ?? TYPE_SIZES[1];
  const ratio = TYPE_LEADINGS[typography.leading]?.ratio ?? TYPE_LEADINGS[1].ratio;
  return { fontSize, lineHeight: Math.round(fontSize * ratio) };
}

/** 「在原文里标出」Plasticine 的重点：每本书各记一份，没选过默认标出。 */
export function loadKeyPointsShown(bookId: string): boolean {
  return read(`${KEY_POINTS_KEY}${bookId}`) !== '0';
}

export function saveKeyPointsShown(bookId: string, shown: boolean): void {
  write(`${KEY_POINTS_KEY}${bookId}`, shown ? '1' : '0');
}

export function loadLocalPosition(bookId: string): LocalPosition | null {
  const value = parsed(read(`${POSITION_KEY}${bookId}`));
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { chapter, offset, percent, savedAt } = value as Record<string, unknown>;
  if (isIndex(chapter, Number.MAX_SAFE_INTEGER) && isIndex(offset, Number.MAX_SAFE_INTEGER)
    && typeof percent === 'number' && typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt))) {
    return { chapter, offset, percent, savedAt };
  }
  return null;
}

export function saveLocalPosition(bookId: string, position: LocalPosition): void {
  write(`${POSITION_KEY}${bookId}`, JSON.stringify(position));
}
