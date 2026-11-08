// 网址其实是 Plasticine 自己的一页（同源的 #/… 地址）：不开网页标签，走过去。
import { internalPageHash } from '../api/shared.ts';
import { parseHash, type Route } from './routes.ts';

export function internalPage(address: string): Route | null {
  const hash = internalPageHash(address, window.location.href);
  return hash === null ? null : parseHash(hash);
}
