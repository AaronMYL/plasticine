// 外观：跟随系统 / 固定浅 / 固定深（第 66 条），写在 <html data-theme>。手动固定时 data-theme 和系统不一致，
// index.html 里按 prefers-color-scheme 分的两条 theme-color 会选错，所以这里把两条一起改成所选主题的底色；
// 回到跟随系统时各自恢复（用户视角审查 2026-11-01 第 16 条）。

export type Appearance = 'system' | 'light' | 'dark';
const KEY = 'plasticine.appearance';

/** 方向 I 的两个底色（tokens.css --bg），也是 index.html 里两条 theme-color 的默认值。 */
const THEME_COLORS: Readonly<Record<'light' | 'dark', string>> = { light: '#FCF9F6', dark: '#2B2826' };

export function readAppearance(): Appearance {
  const value = localStorage.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

function syncThemeColor(value: Appearance): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (value === 'system') {
      const own = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
      meta.setAttribute('content', THEME_COLORS[own]);
    } else {
      meta.setAttribute('content', THEME_COLORS[value]);
    }
  }
}

export function applyAppearance(value = readAppearance()): void {
  if (value === 'system') { delete document.documentElement.dataset['theme']; }
  else { document.documentElement.dataset['theme'] = value; }
  syncThemeColor(value);
}

export function saveAppearance(value: Appearance): void {
  localStorage.setItem(KEY, value);
  applyAppearance(value);
}
