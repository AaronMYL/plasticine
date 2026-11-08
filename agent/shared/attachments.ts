import { Type, type Static } from 'typebox';

export const CONVERSATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
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
export const AttachmentMimeSchema = Type.Enum(ATTACHMENT_MIME_TYPES);
export type AttachmentMime = Static<typeof AttachmentMimeSchema>;
export const ATTACHMENT_ACCEPT = [...ATTACHMENT_MIME_TYPES, '.txt', '.md', '.csv', '.json'].join(',');

export function attachmentMime(type: string, name: string): AttachmentMime | null {
  const mime = type === '' && /\.(txt|md|csv|json)$/i.test(name) ? 'text/plain' : type;
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime) ? mime as AttachmentMime : null;
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
