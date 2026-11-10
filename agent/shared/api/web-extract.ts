import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { SpaceViewSchema } from './spaces.ts';

export const WEB_EXTRACT_PATH = `${API_PREFIX}/browser/extract`;
export const WEB_ARCHIVE_PATH = `${API_PREFIX}/browser/archive`;
export const WEB_EXTRACT_TEXT_MAX = 60_000;
export const WEB_EXTRACT_POINTS_MAX = 12;
export const WEB_EXTRACT_IMAGES_MAX = 12;
const Strict = { additionalProperties: false };
const Url = Type.String({ minLength: 1, maxLength: 4096, pattern: '^https?://' });
export const WebExtractImageSchema = Type.Object({ url: Url, alt: Type.String({ maxLength: 500 }),
  afterText: Type.String({ maxLength: 1000 }) }, Strict);
export const WebExtractImagesSchema = Type.Array(WebExtractImageSchema, { maxItems: WEB_EXTRACT_IMAGES_MAX });
export const WebExtractInputSchema = Type.Object({ url: Url, title: Type.String({ maxLength: 1000 }),
  text: Type.String({ maxLength: WEB_EXTRACT_TEXT_MAX }), totalChars: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(), images: Type.Optional(WebExtractImagesSchema) }, Strict);
export type WebExtractInput = Static<typeof WebExtractInputSchema>;
export const WebExtractPointSchema = Type.Object({ text: Type.String({ minLength: 1, maxLength: 240 }),
  block: Type.Integer({ minimum: 0 }), quote: Type.String({ minLength: 1, maxLength: 1000 }) }, Strict);
export const WebExtractPointsSchema = Type.Array(WebExtractPointSchema, { maxItems: WEB_EXTRACT_POINTS_MAX });
export type WebExtractPoint = Static<typeof WebExtractPointSchema>;
export const WebExtractViewSchema = Type.Object({ url: Url, title: Type.String({ maxLength: 1000 }),
  totalChars: Type.Integer({ minimum: 0 }), truncated: Type.Boolean(),
  blocks: Type.Array(Type.Object({ index: Type.Integer({ minimum: 0 }), kind: Type.Enum(['paragraph', 'heading']),
    text: Type.String({ minLength: 1, maxLength: WEB_EXTRACT_TEXT_MAX }) }, Strict), { maxItems: 2000 }),
  points: WebExtractPointsSchema, images: WebExtractImagesSchema }, Strict);
export type WebExtractView = Static<typeof WebExtractViewSchema>;
export const WebArchiveRequestSchema = Type.Object({ ...WebExtractViewSchema.properties,
  requestId: RequestIdSchema }, Strict);
export type WebArchiveRequest = Static<typeof WebArchiveRequestSchema>;
export const WebArchiveViewSchema = Type.Object({ space: SpaceViewSchema }, Strict);
export type WebArchiveView = Static<typeof WebArchiveViewSchema>;
