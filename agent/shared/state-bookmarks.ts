import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const BOOKMARK_KINDS = ['web', 'page', 'group'] as const;
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number];
export const BOOKMARK_ORIGINS = ['manual', 'feed', 'import'] as const;
export type BookmarkOrigin = (typeof BOOKMARK_ORIGINS)[number];

export const BOOKMARK_TITLE_MAX = 500;
export const BOOKMARK_TARGET_MAX = 4_096;
export const BOOKMARK_GROUP_TABS_MAX = 50;
export const BOOKMARK_SNAPSHOT_MAX_CHARS = 100_000;

export const BookmarkTabSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('web'), Type.Literal('page')]),
    title: Type.String({ maxLength: BOOKMARK_TITLE_MAX }),
    target: Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX }),
  },
  STRICT,
);
export type BookmarkTab = Static<typeof BookmarkTabSchema>;

export const BookmarkInputSchema = Type.Object(
  {
    kind: Type.Enum(BOOKMARK_KINDS),
    title: Type.String({ minLength: 1, maxLength: BOOKMARK_TITLE_MAX }),
    target: Nullable(Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX })),
    projectId: Type.Optional(Nullable(IdSchema)),
    tabs: Type.Optional(Type.Array(BookmarkTabSchema, { maxItems: BOOKMARK_GROUP_TABS_MAX })),
    snapshot: Type.Optional(Nullable(Type.String())),
    snapshotChars: Type.Optional(Type.Integer({ minimum: 0 })),
    origin: Type.Enum(BOOKMARK_ORIGINS),
    feedItemId: Type.Optional(Nullable(IdSchema)),
    position: Type.Integer({ minimum: 0 }),
    deletedAt: Type.Optional(Nullable(IsoTimeSchema)),
  },
  STRICT,
);
export type BookmarkInput = Static<typeof BookmarkInputSchema>;

export const BookmarkPatchSchema = Type.Partial(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: BOOKMARK_TITLE_MAX }),
    projectId: Nullable(IdSchema),
    snapshot: Nullable(Type.String()),
    snapshotChars: Type.Integer({ minimum: 0 }),
    position: Type.Integer({ minimum: 0 }),
    deletedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);

export const BookmarkSchema = Type.Object({ ...RECORD_META, ...Type.Required(BookmarkInputSchema).properties });
export type Bookmark = Static<typeof BookmarkSchema>;
