// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from 'typebox';

export const NETWORK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const NETWORK_ATTACHMENT_MAX_COUNT = 5;
export const NETWORK_THUMBNAIL_MAX_CHARS = 16_000;
export const NETWORK_ATTACHMENT_CIPHER_MAX = Math.ceil(NETWORK_ATTACHMENT_MAX_BYTES * 16 / 9) + 4096;
export const NETWORK_ATTACHMENTS_PATH = '/v2/network/attachments';
export const PEER_ATTACHMENTS_PATH = '/v2/net/attachments';
const STRICT = { additionalProperties: false };
export const NetworkThumbnailSchema = Type.Object({
  mimeType: Type.Enum(['image/jpeg', 'image/png', 'image/webp']),
  width: Type.Integer({ minimum: 1, maximum: 512 }), height: Type.Integer({ minimum: 1, maximum: 512 }),
  content: Type.String({ maxLength: NETWORK_THUMBNAIL_MAX_CHARS, pattern: '^[A-Za-z0-9_-]+$' }),
}, STRICT);
export const NetworkAttachmentMetaSchema = Type.Object({
  id: Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' }),
  name: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\r\\n\\u0000]+$' }),
  mimeType: Type.String({ minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+$' }),
  bytes: Type.Integer({ minimum: 1, maximum: NETWORK_ATTACHMENT_MAX_BYTES }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  width: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  height: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  thumbnail: Type.Optional(NetworkThumbnailSchema),
}, STRICT);
export type NetworkAttachmentMeta = Static<typeof NetworkAttachmentMetaSchema>;
export const NetworkAttachmentListSchema = Type.Array(NetworkAttachmentMetaSchema,
  { maxItems: NETWORK_ATTACHMENT_MAX_COUNT });
export const NetworkAttachmentViewSchema = Type.Object({ ...NetworkAttachmentMetaSchema.properties,
  status: Type.Enum(['pending', 'ready', 'failed']), error: Type.Union([Type.String(), Type.Null()]),
}, STRICT);
export type NetworkAttachmentView = Static<typeof NetworkAttachmentViewSchema>;
export const UploadNetworkAttachmentSchema = Type.Object({
  ...Type.Omit(NetworkAttachmentMetaSchema, ['id']).properties,
  requestId: Type.String({ minLength: 8, maxLength: 200 }),
  content: Type.String({ minLength: 4, maxLength: Math.ceil(NETWORK_ATTACHMENT_MAX_BYTES / 3) * 4,
    pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
}, STRICT);
export type UploadNetworkAttachment = Static<typeof UploadNetworkAttachmentSchema>;
