import { Type, type Static } from 'typebox';

// 第13批（11-14 Aaron：对话的附件支持任意类型；单份上限提到 100 MB、分块上传，弹框同意）：认得的几种（下面的
// ATTACHMENT_MIME_TYPES）照旧预览、读正文；Word、Excel、PowerPoint 在服务端读出文字；别的只告诉模型名字、类型和大小。
export const CONVERSATION_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** 整份一次传的旧路子（联系人之间的附件、Mac 拖进来的文件）还是 10 MiB。 */
export const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** 分块上传每块最多这么大。 */
export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024;
export const CONVERSATION_ATTACHMENT_MAX_COUNT = 5;
export const CONVERSATION_ATTACHMENT_TEXT_LIMIT = 9_000;
/** 认得、能预览的几种（联系人之间的附件只收这些）。 */
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
] as const;
export type KnownAttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];
/** 对话附件的类型：任何「类/型」形状的 MIME（浏览器没给就按后缀猜，猜不出是 application/octet-stream）。 */
export const AttachmentMimeSchema = Type.String({ minLength: 3, maxLength: 160,
  pattern: '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$' });
export type AttachmentMime = Static<typeof AttachmentMimeSchema>;

/** 认得的几种（联系人之间的附件、预览）；别的类型是 null。 */
export function attachmentMime(type: string, name: string): KnownAttachmentMime | null {
  const mime = type === '' && /\.(txt|md|csv|json)$/i.test(name) ? 'text/plain' : type;
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime) ? mime as KnownAttachmentMime : null;
}

const BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const MIME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;

/** 对话附件的类型：浏览器给的像样就用（去掉 ;charset 这类参数），没给按后缀猜，都不行是 application/octet-stream。 */
export function conversationMime(type: string, name: string): string {
  const given = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (given !== '' && given.length <= 160 && MIME_SHAPE.test(given)) return given;
  const dot = name.lastIndexOf('.');
  return BY_EXTENSION[dot < 0 ? '' : name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** 能在对话里直接预览的：三种图、PDF、文字。 */
export function previewable(mime: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime) || mime.startsWith('text/');
}

/** 当图显示的（缩略图、看大图）：PNG、JPEG、WebP；别的图（HEIC、SVG……）当文件，点了下载。 */
export function shownAsImage(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
}
export const AttachmentViewSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ maxLength: 200 }),
  mimeType: AttachmentMimeSchema,
  bytes: Type.Integer({ minimum: 1, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  status: Type.Enum(['uploading', 'ready', 'failed', 'deleting', 'deleted']),
  error: Type.Union([Type.String(), Type.Null()]),
  truncated: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  summary: Type.Union([Type.String(), Type.Null()]),
});
export type AttachmentView = Static<typeof AttachmentViewSchema>;
