import { afterEach, describe, expect, it } from 'vitest';
import css from '../../src/tokens.css?raw';
import { applyAppearance, PALETTES, readPalette, savePalette, THEME_COLORS } from '../../src/shell/appearance.ts';

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`tokens.css 里没有 ${selector}`);
  }
  const body = css.slice(start, css.indexOf('\n}', start));
  return new Map([...body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)]
    .map((match) => [match[1] ?? '', match[2] ?? '']));
}

function luminance(hex: string): number {
  const channel = (index: number): number => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: readonly (readonly [string, string])[] = [
  ['暖纸 浅', ':root'],
  ['暖纸 深', ":root[data-theme='dark']"],
  ...(['graphite', 'pine', 'midnight'] as const).flatMap((palette) => [
    [`${palette} 浅`, `:root[data-palette='${palette}']`] as const,
    [`${palette} 深`, `:root[data-palette='${palette}'][data-theme='dark']`] as const,
  ]),
];

afterEach(() => {
  localStorage.clear();
  applyAppearance();
});

describe('theme presets', () => {
  it.each(THEMES)('%s：字在三种底上都够 4.5:1，强调和状态色当字用也够', (_name, selector) => {
    const tokens = block(selector);
    const get = (name: string): string => {
      const value = tokens.get(name);
      if (value === undefined || !/^#[0-9a-f]{6}$/.test(value)) {
        throw new Error(`${selector} 的 ${name} 不是六位色值：${value ?? '没有'}`);
      }
      return value;
    };
    for (const ground of ['--bg', '--layer-side', '--layer-float']) {
      for (const text of ['--fg', '--fg2', '--fg3']) {
        expect(contrast(get(text), get(ground)), `${text} 在 ${ground} 上`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const text of ['--accent', '--run', '--ok', '--err']) {
      expect(contrast(get(text), get('--bg')), `${text} 在 --bg 上`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(get('--bg'), get('--fg'))).toBeGreaterThanOrEqual(7);
  });

  it('system dark and forced dark define identical CSS token values', () => {
    for (const palette of ['graphite', 'pine', 'midnight']) {
      const media = block(`:root[data-palette='${palette}']:not([data-theme='light'])`);
      const fixed = block(`:root[data-palette='${palette}'][data-theme='dark']`);
      expect([...media]).toEqual([...fixed]);
    }
  });

  it('selecting theme sets data-palette (omitted for warm paper), theme-color, and persists', () => {
    const metas = [['(prefers-color-scheme: light)', '#FAF8F4'], ['(prefers-color-scheme: dark)', '#1C1B19']];
    for (const [media, content] of metas) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.setAttribute('media', media ?? '');
      meta.content = content ?? '';
      document.head.append(meta);
    }
    const colors = (): string[] => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
      .map((meta) => meta.content);
    savePalette('midnight');
    expect(document.documentElement.dataset['palette']).toBe('midnight');
    expect(colors()).toEqual([THEME_COLORS.midnight.light, THEME_COLORS.midnight.dark]);
    expect(readPalette()).toBe('midnight');
    savePalette('paper');
    expect(document.documentElement.dataset['palette']).toBeUndefined();
    expect(colors()).toEqual([THEME_COLORS.paper.light, THEME_COLORS.paper.dark]);
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  });

  it('each preset background matches tokens.css', () => {
    for (const palette of PALETTES) {
      const light = palette === 'paper' ? ':root' : `:root[data-palette='${palette}']`;
      const dark = palette === 'paper' ? ":root[data-theme='dark']"
        : `:root[data-palette='${palette}'][data-theme='dark']`;
      expect(block(light).get('--bg')).toBe(THEME_COLORS[palette].light.toLowerCase());
      expect(block(dark).get('--bg')).toBe(THEME_COLORS[palette].dark.toLowerCase());
    }
  });
});
