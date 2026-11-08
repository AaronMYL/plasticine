// 网址其实是 Plasticine 自己的一页（同源的 #/… 地址）：不开网页标签，走过去。
import { internalPageHash, LEGACY_PUBLIC_URLS } from '../api/shared.ts';
import { parseHash, type Route } from './routes.ts';

export function internalPage(address: string): Route | null {
  const hash = internalPageHash(address, window.location.href);
  return hash === null ? null : parseHash(hash);
}

/**
 * 消息里 Plasticine 写的完整网址（第 7 批第 14 条）：指向本实例（当前 origin）或以前写进去的旧 IP、而且是 #/ 路由的，
 * 换成站内的 #/… 地址，点了在 Plasticine 里走过去，不新开窗口。别的（站外、附件、没有 #/ 的）是 null。
 */
export function inAppHash(href: string, base: string = window.location.href): string | null {
  if (!/^https?:\/\/[^#]*#\//i.test(href)) {
    return null;
  }
  for (const server of [base, ...LEGACY_PUBLIC_URLS]) {
    const hash = internalPageHash(href, server);
    if (hash !== null) {
      return hash;
    }
  }
  return null;
}
