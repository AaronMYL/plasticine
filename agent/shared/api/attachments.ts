import { Type, type Static } from 'typebox';
import { AttachmentMimeSchema, AttachmentViewSchema, CONVERSATION_ATTACHMENT_MAX_BYTES } from '../attachments.ts';
import { RequestIdSchema } from './common.ts';

export * from '../attachments.ts';
export const ATTACHMENTS_PATH = '/v2/conversation/attachments';
export const AttachmentLookupSchema = Type.Union([AttachmentViewSchema, Type.Null()]);
export const AttachmentTextViewSchema = Type.Object({
  text: Type.Union([Type.String(), Type.Null()]), characters: Type.Integer({ minimum: 0 }), truncated: Type.Boolean(),
});
export type AttachmentTextView = Static<typeof AttachmentTextViewSchema>;
export const UploadAttachmentMetaSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    mimeType: AttachmentMimeSchema,
    bytes: Type.Integer({ minimum: 1, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
export type UploadAttachmentMeta = Static<typeof UploadAttachmentMetaSchema>;
export const ATTACHMENT_UPLOADS_PATH = `${ATTACHMENTS_PATH}/uploads`;
export const attachmentChunkPath = (id: string, offset: number): string =>
  `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/chunks/${offset}`;
export const attachmentCompletePath = (id: string): string => `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/complete`;
export const AttachmentUploadSchema = Type.Object({
  attachment: AttachmentViewSchema,
  received: Type.Integer({ minimum: 0, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
}, { additionalProperties: false });
export const AttachmentChunkResultSchema = Type.Object({
  received: Type.Integer({ minimum: 0, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
}, { additionalProperties: false });
