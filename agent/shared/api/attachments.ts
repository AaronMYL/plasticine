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
export const UploadAttachmentRequestSchema = Type.Object(
  {
    ...UploadAttachmentMetaSchema.properties,
    content: Type.String({
      minLength: 4,
      maxLength: Math.ceil(CONVERSATION_ATTACHMENT_MAX_BYTES / 3) * 4,
      pattern: '^[A-Za-z0-9+/]*={0,2}$',
    }),
  },
  { additionalProperties: false },
);
export type UploadAttachmentRequest = Static<typeof UploadAttachmentRequestSchema>;
