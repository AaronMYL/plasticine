import { Type, type Static } from 'typebox';

export const LINK_PREVIEW_PATH = '/v2/link-preview';
/**
 * 回复里的图（11-14 图片统一：Plasticine 回复里的图直接显示，经服务端转一道）：要会话，服务端代取远程图回字节，
 * 和邮件图片代理同一套防 SSRF 的取法；只收 http(s)。
 */
export const IMAGE_PROXY_PATH = '/v2/image';
export const ImageProxyQuerySchema = Type.Object({ url: Type.String({ minLength: 1, maxLength: 3000 }) },
  { additionalProperties: false });
export const LinkPreviewQuerySchema = Type.Object({ url: Type.String({ minLength: 1, maxLength: 3000 }) },
  { additionalProperties: false });
export const LinkPreviewSchema = Type.Object({
  url: Type.String({ maxLength: 3000 }),
  title: Type.String({ maxLength: 300 }),
  site: Type.String({ maxLength: 200 }),
  description: Type.String({ maxLength: 600 }),
  image: Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]),
}, { additionalProperties: false });
export type LinkPreview = Static<typeof LinkPreviewSchema>;
