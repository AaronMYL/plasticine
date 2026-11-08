// /v2/favicon?host=：网站图标由本体代取（11-08 他定「网页的标签要能够显示对应网站的图标」）。不用 Google 之类的第三方
// 图标服务：那样会把他看了哪些网站发给第三方。本体按域名去那个网站自己取（页面里的 <link rel="icon">，没有就
// /favicon.ico），存进库里，过期再取。回的是图片字节；这个网站没有图标是 404，界面照旧画首字母方块。

import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { WebTabIconEventSchema } from './desktop-bridge.ts';

export const FAVICON_PATH = `${API_PREFIX}/favicon`;

/** 只收域名（小写，punycode）：不带端口、路径、账号；IP 地址也不收。 */
export const FAVICON_HOST_PATTERN = '^(?![\\d.]+$)(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\\.(?!-)[a-z0-9-]{1,63})+$';

export const FaviconQuerySchema = Type.Object({
  host: Type.String({ pattern: FAVICON_HOST_PATTERN }),
}, { additionalProperties: false });
export type FaviconQuery = Static<typeof FaviconQuerySchema>;

/** 网址 → 取图标用的域名（去掉 www.）；不是 http(s) 的网址、IP 地址是 null。 */
export function faviconHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    if (cause instanceof TypeError) {
      return null;
    }
    throw cause;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return new RegExp(FAVICON_HOST_PATTERN).test(host) ? host : null;
}

export function faviconPath(host: string): string {
  return `${FAVICON_PATH}?host=${encodeURIComponent(host)}`;
}

/**
 * PUT /v2/favicon → 200 { host }：桌面壳报来的网站图标（页面自己的 favicon，data: 地址，≤ 64 KB）按 pageUrl 的域名
 * 存进本体的图标缓存，别的设备画这个网站时也用它。不是图片、网址不是 http(s) 域名的 400。
 */
export const PutFaviconRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  pageUrl: WebTabIconEventSchema.properties.pageUrl,
  icon: WebTabIconEventSchema.properties.icon,
}, { additionalProperties: false });
export type PutFaviconRequest = Static<typeof PutFaviconRequestSchema>;
export const PutFaviconResponseSchema = Type.Object({ host: Type.String() }, { additionalProperties: false });
export type PutFaviconResponse = Static<typeof PutFaviconResponseSchema>;
