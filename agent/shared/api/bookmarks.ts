import { Type, type Static } from 'typebox';
import {
  BOOKMARK_GROUP_TABS_MAX,
  BOOKMARK_KINDS,
  BOOKMARK_ORIGINS,
  BOOKMARK_SNAPSHOT_MAX_CHARS,
  BOOKMARK_TARGET_MAX,
  BOOKMARK_TITLE_MAX,
  BookmarkTabSchema,
} from '../state-bookmarks.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const BOOKMARKS_PATH = `${API_PREFIX}/bookmarks`;
export const BOOKMARKS_ORDER_PATH = `${BOOKMARKS_PATH}/order`;
export const BOOKMARKS_IMPORT_PATH = `${BOOKMARKS_PATH}/import`;

export const BOOKMARK_IMPORT_MAX = 1_000;
export const BOOKMARK_ORDER_MAX = 5_000;

const STRICT = { additionalProperties: false };
const Title = Type.String({ minLength: 1, maxLength: BOOKMARK_TITLE_MAX });
const Target = Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX });

export const BookmarkViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(BOOKMARK_KINDS),
  title: Type.String(),
  target: OrNull(Type.String()),
  projectId: OrNull(IdSchema),
  tabs: Type.Array(BookmarkTabSchema),
  origin: Type.Enum(BOOKMARK_ORIGINS),
  feedItemId: OrNull(IdSchema),
  snapshotChars: Type.Integer({ minimum: 0 }),
  position: Type.Integer({ minimum: 0 }),
  suggestedProjectId: OrNull(IdSchema),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type BookmarkView = Static<typeof BookmarkViewSchema>;

export const BookmarkListResponseSchema = Type.Object({ bookmarks: Type.Array(BookmarkViewSchema) });
export type BookmarkListResponse = Static<typeof BookmarkListResponseSchema>;
export const BookmarkResponseSchema = Type.Object({ bookmark: BookmarkViewSchema });
export type BookmarkResponse = Static<typeof BookmarkResponseSchema>;

export const BookmarkSnapshotSchema = Type.Object(
  {
    text: Type.String({ maxLength: BOOKMARK_SNAPSHOT_MAX_CHARS * 2 }),
    totalChars: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);

export const AddBookmarkRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    kind: Type.Enum(BOOKMARK_KINDS),
    title: Title,
    target: Type.Optional(Target),
    projectId: Type.Optional(OrNull(IdSchema)),
    tabs: Type.Optional(Type.Array(BookmarkTabSchema, { minItems: 1, maxItems: BOOKMARK_GROUP_TABS_MAX })),
    snapshot: Type.Optional(BookmarkSnapshotSchema),
  },
  STRICT,
);
export type AddBookmarkRequest = Static<typeof AddBookmarkRequestSchema>;

export const EditBookmarkRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    title: Type.Optional(Title),
    projectId: Type.Optional(OrNull(IdSchema)),
  },
  STRICT,
);
export type EditBookmarkRequest = Static<typeof EditBookmarkRequestSchema>;

export const RemoveBookmarkRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RemoveBookmarkRequest = Static<typeof RemoveBookmarkRequestSchema>;

export const RestoreBookmarkRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RestoreBookmarkRequest = Static<typeof RestoreBookmarkRequestSchema>;

export const OrderBookmarksRequestSchema = Type.Object(
  { requestId: RequestIdSchema, ids: Type.Array(IdSchema, { minItems: 1, maxItems: BOOKMARK_ORDER_MAX }) },
  STRICT,
);
export type OrderBookmarksRequest = Static<typeof OrderBookmarksRequestSchema>;

export const ImportBookmarkItemSchema = Type.Object(
  {
    title: Type.String({ maxLength: BOOKMARK_TITLE_MAX }),
    url: Target,
    projectId: OrNull(IdSchema),
  },
  STRICT,
);
export type ImportBookmarkItem = Static<typeof ImportBookmarkItemSchema>;

export const ImportBookmarksRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    items: Type.Array(ImportBookmarkItemSchema, { minItems: 1, maxItems: BOOKMARK_IMPORT_MAX }),
  },
  STRICT,
);
export type ImportBookmarksRequest = Static<typeof ImportBookmarksRequestSchema>;
export const ImportBookmarksResponseSchema = Type.Object({
  added: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  bookmarks: Type.Array(BookmarkViewSchema),
});
export type ImportBookmarksResponse = Static<typeof ImportBookmarksResponseSchema>;
