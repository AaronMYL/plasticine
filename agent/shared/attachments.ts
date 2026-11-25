import { Type, type Static } from 'typebox';

export const CONVERSATION_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024;
export const CONVERSATION_ATTACHMENT_MAX_COUNT = 5;
export const CONVERSATION_ATTACHMENT_TEXT_LIMIT = 9_000;
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
export const AttachmentMimeSchema = Type.String({ minLength: 3, maxLength: 160,
  pattern: '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$' });
export type AttachmentMime = Static<typeof AttachmentMimeSchema>;

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

export function conversationMime(type: string, name: string): string {
  const given = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (given !== '' && given.length <= 160 && MIME_SHAPE.test(given)) return given;
  const dot = name.lastIndexOf('.');
  return BY_EXTENSION[dot < 0 ? '' : name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

export function previewable(mime: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime) || mime.startsWith('text/');
}

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
