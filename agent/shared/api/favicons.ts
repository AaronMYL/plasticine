import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { WebTabIconEventSchema } from './desktop-bridge.ts';

export const FAVICON_PATH = `${API_PREFIX}/favicon`;

export const FAVICON_HOST_PATTERN = '^(?![\\d.]+$)(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\\.(?!-)[a-z0-9-]{1,63})+$';

export const FaviconQuerySchema = Type.Object({
  host: Type.String({ pattern: FAVICON_HOST_PATTERN }),
}, { additionalProperties: false });

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

export const PutFaviconRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  pageUrl: WebTabIconEventSchema.properties.pageUrl,
  icon: WebTabIconEventSchema.properties.icon,
}, { additionalProperties: false });
export type PutFaviconRequest = Static<typeof PutFaviconRequestSchema>;
export const PutFaviconResponseSchema = Type.Object({ host: Type.String() }, { additionalProperties: false });
export type PutFaviconResponse = Static<typeof PutFaviconResponseSchema>;
