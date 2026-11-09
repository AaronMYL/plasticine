// 空间网页的深浅色（第 8 批第 6 条）：iframe 是另一份文档，拿不到 Plasticine 的令牌。打开时把当前的值读出来写进
// srcdoc，之后外观一变（设置里切浅 / 深，或者跟随系统时系统变了）再传一次。

import { useEffect, useState } from 'react';
import { SPACE_TOKENS, type SpaceToken } from '../../../../agent/shared/space-page/base-css.ts';

export interface SpaceTheme {
  tokens: Partial<Record<SpaceToken, string>>;
  dark: boolean;
}

/** iframe 里叫 --float 的，Plasticine 里叫 --layer-float。 */
const SOURCE: Partial<Record<SpaceToken, string>> = { '--float': '--layer-float' };

export function readSpaceTheme(): SpaceTheme {
  const style = getComputedStyle(document.documentElement);
  const tokens: Partial<Record<SpaceToken, string>> = {};
  for (const name of SPACE_TOKENS) {
    const value = style.getPropertyValue(SOURCE[name] ?? name).trim();
    if (value !== '') tokens[name] = value;
  }
  return { tokens, dark: style.colorScheme === 'dark' };
}

function sameTheme(a: SpaceTheme, b: SpaceTheme): boolean {
  return a.dark === b.dark && SPACE_TOKENS.every((name) => a.tokens[name] === b.tokens[name]);
}

/** 当前的深浅色；外观变了跟着变。 */
export function useSpaceTheme(): SpaceTheme {
  const [theme, setTheme] = useState(readSpaceTheme);
  useEffect(() => {
    const update = (): void => {
      const next = readSpaceTheme();
      setTheme((current) => (sameTheme(current, next) ? current : next));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', update);
    };
  }, []);
  return theme;
}
