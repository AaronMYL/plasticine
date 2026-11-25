import { useEffect } from 'react';
import { internalPage } from './internal-page.ts';

type Opener = (url: string, title: string) => void;

let webTabOpener: Opener | null = null;

export function setWebTabOpener(opener: Opener | null): void {
  webTabOpener = opener;
}

export function externalUrl(href: string, base: string = window.location.href): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch (cause) {
    console.warn('链接地址解不开，照浏览器默认处理', cause);
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  return url.origin === new URL(base).origin ? null : url.href;
}

export function openExternal(url: string, title = ''): void {
  if (webTabOpener !== null && (externalUrl(url) !== null || internalPage(url) !== null)) {
    webTabOpener(url, title);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
}

export function useExternalLinks(open: Opener | null): void {
  useEffect(() => {
    setWebTabOpener(open);
    if (open === null) {
      return undefined;
    }
    const intercept = (event: MouseEvent): void => {
      if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) {
        return;
      }
      const anchor = anchorOf(event.target);
      if (anchor === null || anchor.hasAttribute('download')) {
        return;
      }
      const href = anchor.getAttribute('href') ?? '';
      const url = externalUrl(href) ?? (!href.startsWith('#') && internalPage(href) !== null ? href : null);
      if (url === null) {
        return;
      }
      event.preventDefault();
      const title = (anchor.textContent ?? '').trim() || anchor.title || url;
      open(url, title);
    };
    document.addEventListener('click', intercept, true);
    document.addEventListener('auxclick', intercept, true);
    return () => {
      document.removeEventListener('click', intercept, true);
      document.removeEventListener('auxclick', intercept, true);
      setWebTabOpener(null);
    };
  }, [open]);
}
