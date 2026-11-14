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
/**
 * 分块上传（第13批）：先 POST /uploads 报这份文件（同一个 requestId 再报回同一行和已经收到多少字节），再按顺序
 * PUT /:id/chunks/:offset 一块块传原始字节（每块 ≤ ATTACHMENT_CHUNK_BYTES），最后 POST /:id/complete 核对大小和摘要、
 * 读出能读的正文。断了就从「已经收到多少」接着传。
 */
export const ATTACHMENT_UPLOADS_PATH = `${ATTACHMENTS_PATH}/uploads`;
export const attachmentChunkPath = (id: string, offset: number): string =>
  `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/chunks/${offset}`;
export const attachmentCompletePath = (id: string): string => `${ATTACHMENTS_PATH}/${encodeURIComponent(id)}/complete`;
export const AttachmentUploadSchema = Type.Object({
  attachment: AttachmentViewSchema,
  received: Type.Integer({ minimum: 0, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
}, { additionalProperties: false });
export type AttachmentUpload = Static<typeof AttachmentUploadSchema>;
export const AttachmentChunkResultSchema = Type.Object({
  received: Type.Integer({ minimum: 0, maximum: CONVERSATION_ATTACHMENT_MAX_BYTES }),
}, { additionalProperties: false });
export type AttachmentChunkResult = Static<typeof AttachmentChunkResultSchema>;
