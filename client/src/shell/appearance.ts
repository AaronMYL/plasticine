export type Appearance = 'system' | 'light' | 'dark';
export const PALETTES = ['paper', 'graphite', 'pine', 'midnight'] as const;
export type Palette = (typeof PALETTES)[number];
export const PALETTE_LABELS: Readonly<Record<Palette, string>> = {
  paper: '暖纸', graphite: '石墨', pine: '松林', midnight: '午夜',
};
const KEY = 'plasticine.appearance';
const PALETTE_KEY = 'plasticine.palette';

export const THEME_COLORS: Readonly<Record<Palette, Readonly<Record<'light' | 'dark', string>>>> = {
  paper: { light: '#FAF8F4', dark: '#1C1B19' },
  graphite: { light: '#FFFFFF', dark: '#1C1C1E' },
  pine: { light: '#F8F6EE', dark: '#1E2421' },
  midnight: { light: '#FAFAFD', dark: '#17182A' },
};

export const PALETTE_ACCENTS: Readonly<Record<Palette, string>> = {
  paper: '#8F5238', graphite: '#0A63C9', pine: '#3F6F52', midnight: '#5046C8',
};

export function readAppearance(): Appearance {
  const value = localStorage.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readPalette(): Palette {
  const value = localStorage.getItem(PALETTE_KEY);
  return PALETTES.find((palette) => palette === value) ?? 'paper';
}

function syncThemeColor(value: Appearance, palette: Palette): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', THEME_COLORS[palette][value === 'system' ? own : value]);
  }
}

export function applyAppearance(value = readAppearance(), palette = readPalette()): void {
  const root = document.documentElement;
  if (value === 'system') { delete root.dataset['theme']; }
  else { root.dataset['theme'] = value; }
  if (palette === 'paper') { delete root.dataset['palette']; }
  else { root.dataset['palette'] = palette; }
  syncThemeColor(value, palette);
}

export function saveAppearance(value: Appearance): void {
  localStorage.setItem(KEY, value);
  applyAppearance(value);
}

export function savePalette(palette: Palette): void {
  localStorage.setItem(PALETTE_KEY, palette);
  applyAppearance(readAppearance(), palette);
}
