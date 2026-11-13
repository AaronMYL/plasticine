// 动态背景的颜色都从页面令牌里读（字的三档和 --hue-*），换主题、换浅深时重读，不在这里写死颜色。

import { TONES, type Tone } from './body.ts';

const TONE_VARS: Readonly<Record<Tone, string>> = {
  ink: '--fg', muted: '--fg2', faint: '--fg3', slate: '--hue-slate', sky: '--hue-sky', teal: '--hue-teal',
  clay: '--hue-clay', ochre: '--hue-ochre', olive: '--hue-olive', sage: '--hue-sage', indigo: '--hue-indigo',
  rose: '--hue-rose', plum: '--hue-plum',
};

/** 透明度分这么多档，同一档同一个颜色字串，少拼字符串。 */
const LEVELS = 24;

export interface AmbientPalette {
  /** 底是深色：字越密越亮，明暗的对应要反过来。 */
  dark: boolean;
  style: (tone: Tone, alpha: number) => string;
}

type Rgb = readonly [number, number, number];

/** 把任意 CSS 颜色转成 rgb：交给 canvas 规整（它会给出 #rrggbb 或 rgba(…)）。 */
function parseColor(probe: CanvasRenderingContext2D, value: string): Rgb | null {
  probe.fillStyle = '#000';
  probe.fillStyle = value;
  const out = String(probe.fillStyle);
  const hex = /^#([0-9a-f]{6})$/i.exec(out);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const luminance = ([r, g, b]: Rgb): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function readPalette(source: Element, probe: CanvasRenderingContext2D): AmbientPalette {
  const computed = getComputedStyle(source);
  const read = (name: string, fallback: Rgb): Rgb => parseColor(probe, computed.getPropertyValue(name).trim())
    ?? fallback;
  const fg = read('--fg', [31, 29, 26]);
  const bg = read('--bg', [250, 248, 244]);
  const table = new Map<Tone, string[]>();
  for (const tone of TONES) {
    const [r, g, b] = tone === 'ink' ? fg : read(TONE_VARS[tone], fg);
    table.set(tone, Array.from({ length: LEVELS + 1 }, (_, i) => `rgba(${r},${g},${b},${(i / LEVELS).toFixed(3)})`));
  }
  return {
    dark: luminance(bg) < 0.4,
    style: (tone, alpha) => {
      const level = Math.round(Math.min(1, Math.max(0, alpha)) * LEVELS);
      return table.get(tone)![level]!;
    },
  };
}
