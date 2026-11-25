import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_IMAGE_RATIO_MAX, FEED_IMAGE_RATIO_MIN, FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_XHS_PATH = `${API_PREFIX}/nodes/feed/xhs`;

export const XHS_NOTES_MAX = 200;
export const XHS_TITLE_MAX_CHARS = 200;
export const XHS_PLACES = ['recommend', 'saved'] as const;
export type XhsPlace = (typeof XHS_PLACES)[number];
export const XHS_ID_PATTERN = '^[0-9a-f]{24}$';
export const XHS_TOKEN_PATTERN = '^[A-Za-z0-9+/=_-]{1,200}$';

const HttpsSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });

export const XhsNoteSchema = Type.Object({
  id: Type.String({ pattern: XHS_ID_PATTERN }),
  xsecToken: Type.Optional(Type.String({ pattern: XHS_TOKEN_PATTERN })),
  title: Type.String({ maxLength: XHS_TITLE_MAX_CHARS }),
  author: Type.String({ minLength: 1, maxLength: 100 }),
  avatar: OrNull(HttpsSchema),
  image: OrNull(HttpsSchema),
  imageRatio: OrNull(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX })),
  video: Type.Boolean(),
  places: Type.Array(Type.Enum(XHS_PLACES), { minItems: 1, maxItems: XHS_PLACES.length }),
}, { additionalProperties: false });
export type XhsNote = Static<typeof XhsNoteSchema>;

export const XHS_READ_ERRORS = ['signed_out', 'verify', 'layout_changed', 'load_failed'] as const;

export const XhsReportSchema = Type.Object({
  requestId: RequestIdSchema,
  notes: Type.Array(XhsNoteSchema, { maxItems: XHS_NOTES_MAX }),
  error: OrNull(Type.Object({
    code: Type.Enum(XHS_READ_ERRORS),
    detail: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type XhsReport = Static<typeof XhsReportSchema>;

export const XhsDueSchema = Type.Object({
  due: Type.Boolean(),
  everyMinutes: Type.Integer({ minimum: 1 }),
});
export type XhsDue = Static<typeof XhsDueSchema>;

export const XhsReportResponseSchema = Type.Object({ added: Type.Integer({ minimum: 0 }) });
export type XhsReportResponse = Static<typeof XhsReportResponseSchema>;
