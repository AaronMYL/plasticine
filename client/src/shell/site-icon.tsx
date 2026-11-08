// 网站图标（11-08 他定「网页的标签要能够显示对应网站的图标」）：置顶格子、分组里、今天、窄栏、⌘K 的标签结果、
// 新标签页和历史都用它。先用桌面壳报来的（页面自己的 favicon，host.ts 的「标签图标变了」），没有就用本体代取的
// （/v2/favicon，按域名，存在库里；浏览器缓存一天，所以第二次画就是现成的），都拿不到画首字母方块（颜色按网站固定）。
// 16px、圆角 4；深色模式下透明底的图标垫一块很淡的底（site-icon.css），不至于黑字黑底看不见。纯装饰，读屏读旁边的标题。

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useApiOrNull } from '../api/context.tsx';
import { faviconHost, PROJECT_HUES, type ProjectHue } from '../api/shared.ts';
import { useClientStateOrNull } from '../state/context.tsx';
import { Store } from '../state/store.ts';
import { useStore } from '../state/use-store.ts';
import { hueVar } from './hue.tsx';
import './site-icon.css';

/** 这次打开里已经画出来过的图标地址：再画时直接出图，不先空一下。 */
const shown = new Set<string>();
/** 这次打开里取不到的：不再试，直接画首字母。 */
const failed = new Set<string>();
const NO_ICONS = new Store<ReadonlyMap<string, string>>(new Map());

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (cause) {
    if (cause instanceof TypeError) {
      return '';
    }
    throw cause;
  }
}

function hueFor(key: string): ProjectHue {
  const sum = Array.from(key).reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0);
  return PROJECT_HUES[sum % PROJECT_HUES.length]!;
}

export interface SiteIconProps {
  url: string;
  title: string;
  size?: number;
  /** 是哪个标签（有就先看桌面壳报来的图标）。 */
  tabId?: string | undefined;
}

export function SiteIcon({ url, title, size = 16, tabId }: SiteIconProps): ReactNode {
  const api = useApiOrNull();
  const state = useClientStateOrNull();
  const hostIcons = useStore(state?.webTabs.icons ?? NO_ICONS);
  const fromHost = tabId === undefined ? undefined : hostIcons.get(tabId);
  const domain = faviconHost(url);
  const src = fromHost ?? (domain === null ? null : api?.webTabs.faviconSrc(domain) ?? null);
  // 图标载入、失败记在模块里（按地址），这里只用来重画一次。
  const [, redraw] = useState(0);
  if (src !== null && !failed.has(src)) {
    const ready = shown.has(src);
    return (
      <span className="site-icon" data-kind="image" data-ready={ready} aria-hidden="true"
        style={{ width: size, height: size }}>
        <img src={src} alt="" width={size} height={size} draggable={false} decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            shown.add(src);
            redraw((count) => count + 1);
          }}
          onError={() => {
            failed.add(src);
            redraw((count) => count + 1);
          }} />
      </span>
    );
  }
  const host = hostOf(url);
  const letter = (Array.from(host || title.trim())[0] ?? '·').toLocaleUpperCase();
  return (
    <span className="site-icon" data-kind="letter" aria-hidden="true"
      style={{ '--site-hue': hueVar(hueFor(host || title)), width: size, height: size } as CSSProperties}>
      {letter}
    </span>
  );
}
