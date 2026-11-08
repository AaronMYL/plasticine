// 站外链接统一从这里开（2026-11-03）：有网页标签桥（Mac 0.2.0 起的 window.plasticineDesktop.webTabs、iPhone 0.2.0 起的
// window.plasticineIOS.webTabs，第 114 条）时，全站的站外链接（信息流、消息和 markdown 里的链接、笔记里的链接、成果、
// 项目资料……）都开成 Plasticine 的网页标签；没有这个桥（网页版、手机浏览器、旧 App）保持现状：<a target="_blank">
// 照常、代码里打开就新窗口（系统浏览器）。
// 做法是一处统一的拦截：壳在 document 上捕获点击（useExternalLinks），各处的 <a> 不用各写一套；代码里要打开网址的
// 调 openExternal()。站内地址（#/…、同源的附件和截图）不拦。

import { useEffect } from 'react';
import { internalPage } from './internal-page.ts';

type Opener = (url: string, title: string) => void;

let webTabOpener: Opener | null = null;

/** 壳挂上 / 摘下网页标签的打开方式（只在有原生网页标签桥时挂）。 */
export function setWebTabOpener(opener: Opener | null): void {
  webTabOpener = opener;
}

/** 站外的 http(s) 地址：返回规整过的网址；站内的、别的协议（mailto:、tel:、blob:）返回 null。 */
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

/** 代码里要打开一个站外网址：有网页标签就开成标签，没有就新窗口（系统浏览器）。 */
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

/**
 * 壳用：有网页标签时在 document 上捕获站外链接的点击（左键、中键、⌘ / Ctrl 点），开成 Plasticine 的网页标签。
 * 下载链接（download 属性）不拦。open 为 null（没有桥）时什么也不做。
 */
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
