import { Type, type Static } from 'typebox';

export const LINK_PREVIEW_PATH = '/v2/link-preview';
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
