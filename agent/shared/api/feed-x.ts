import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_IMAGE_RATIO_MAX, FEED_IMAGE_RATIO_MIN, FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_X_PATH = `${API_PREFIX}/nodes/feed/x`;

export const X_POSTS_MAX = 300;
export const X_PLACES = ['following', 'recommend', 'bookmark'] as const;
export type XPlace = (typeof X_PLACES)[number];
export const X_TEXT_MAX_CHARS = 4_000;

const HttpsSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });
const RatioSchema = Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX });

export const X_IMAGES_MAX = 4;
export const XImageSchema = Type.Object({
  url: HttpsSchema,
  ratio: OrNull(RatioSchema),
}, { additionalProperties: false });

export const XPostSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9]{1,30}$' }),
  handle: Type.String({ pattern: '^[A-Za-z0-9_]{1,30}$' }),
  author: Type.String({ minLength: 1, maxLength: 200 }),
  avatar: OrNull(HttpsSchema),
  text: Type.String({ maxLength: X_TEXT_MAX_CHARS }),
  image: OrNull(HttpsSchema),
  imageRatio: OrNull(RatioSchema),
  images: Type.Optional(Type.Array(XImageSchema, { maxItems: X_IMAGES_MAX })),
  publishedAt: OrNull(IsoTimeSchema),
  places: Type.Optional(Type.Array(Type.Enum(X_PLACES), { minItems: 1, maxItems: X_PLACES.length })),
}, { additionalProperties: false });
export type XPost = Static<typeof XPostSchema>;

export const X_READ_ERRORS = ['signed_out', 'layout_changed', 'load_failed'] as const;

export const XTimelineReportSchema = Type.Object({
  requestId: RequestIdSchema,
  posts: Type.Array(XPostSchema, { maxItems: X_POSTS_MAX }),
  error: OrNull(Type.Object({
    code: Type.Enum(X_READ_ERRORS),
    detail: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type XTimelineReport = Static<typeof XTimelineReportSchema>;

export const XTimelineDueSchema = Type.Object({
  due: Type.Boolean(),
  everyMinutes: Type.Integer({ minimum: 1 }),
});
export type XTimelineDue = Static<typeof XTimelineDueSchema>;

export const XTimelineReportResponseSchema = Type.Object({ added: Type.Integer({ minimum: 0 }) });
export type XTimelineReportResponse = Static<typeof XTimelineReportResponseSchema>;
