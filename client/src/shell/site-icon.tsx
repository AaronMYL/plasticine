import { useState, type CSSProperties, type ReactNode } from 'react';
import { useApiOrNull } from '../api/context.tsx';
import { faviconHost, PROJECT_HUES, type ProjectHue } from '../api/shared.ts';
import { useClientStateOrNull } from '../state/context.tsx';
import { Store } from '../state/store.ts';
import { useStore } from '../state/use-store.ts';
import { hueVar } from './hue.tsx';
import './site-icon.css';

const shown = new Set<string>();
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
  tabId?: string | undefined;
}

export function SiteIcon({ url, title, size = 16, tabId }: SiteIconProps): ReactNode {
  const api = useApiOrNull();
  const state = useClientStateOrNull();
  const hostIcons = useStore(state?.webTabs.icons ?? NO_ICONS);
  const fromHost = tabId === undefined ? undefined : hostIcons.get(tabId);
  const domain = faviconHost(url);
  const src = fromHost ?? (domain === null ? null : api?.webTabs.faviconSrc(domain) ?? null);
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
