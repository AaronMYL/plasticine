// /v2/bookmarks：书签（2026-11-03 用户定，第 110 条）。列表（按 position 排，删掉的不在里面）、加（⌘D / ☆ / 右键标签 /
// 「关掉，存进书签」存一组）、改名和移项目、移除、撤销移除、排序、导入浏览器导出的书签 HTML。每个写操作按 requestId
// 幂等，改、移除和撤销带它画出来时的 version，过时就 409 带现在的那一条；写成了发 bookmarks_changed（各设备同一份）。
// 第 8 批第 1 条（11-09）：书签在网页栏最上面单独一节，和标签分开；地址框里的书签按钮加 / 取消当前网址。信息流的收藏仍走 /v2/feed/items/:id/save，服务端把它
// 记成一条 origin = feed 的书签。

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

/** 一次导入最多这么多条：再多分几次送（请求体上限 2 MB）。 */
export const BOOKMARK_IMPORT_MAX = 1_000;
/** 一次排序最多带这么多个标识。 */
export const BOOKMARK_ORDER_MAX = 5_000;

const STRICT = { additionalProperties: false };
const Title = Type.String({ minLength: 1, maxLength: BOOKMARK_TITLE_MAX });
const Target = Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX });

export const BookmarkViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(BOOKMARK_KINDS),
  title: Type.String(),
  /** 网页的网址、页面的 #/… 地址；保存的分组是 null。 */
  target: OrNull(Type.String()),
  projectId: OrNull(IdSchema),
  tabs: Type.Array(BookmarkTabSchema),
  origin: Type.Enum(BOOKMARK_ORIGINS),
  feedItemId: OrNull(IdSchema),
  /** 存了多少字正文（原文字数）；0 是没存。正文本身不随列表回来。 */
  snapshotChars: Type.Integer({ minimum: 0 }),
  position: Type.Integer({ minimum: 0 }),
  /** 没归项目的那几条：Plasticine 推的项目（✦，点一下归进去）；拿不准是 null。 */
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
    /** 原文有多少字（Unicode 字符）。 */
    totalChars: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type BookmarkSnapshot = Static<typeof BookmarkSnapshotSchema>;

/**
 * POST /v2/bookmarks → 201 { bookmark }。网页和页面要 target，保存的分组要 tabs。同一个网址 / 地址已经有书签时回
 * 200 和那一条（不重复加）。
 */
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

/** PUT /v2/bookmarks/:id → 200 { bookmark }：改名、移到别的项目（null = 没归项目）。 */
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

/** POST /v2/bookmarks/:id/remove → 200 { bookmark }：移除（行留着，只记时间；信息流那一条随之取消收藏）。 */
export const RemoveBookmarkRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RemoveBookmarkRequest = Static<typeof RemoveBookmarkRequestSchema>;

/**
 * POST /v2/bookmarks/:id/restore → 200 { bookmark }：撤销移除（第 8 批第 1 条：删除不确认，原处一行「撤销」）。
 * version 是移除回来的那一版；同一个网址这期间又加了一条就回那一条，不出两条。
 */
export const RestoreBookmarkRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RestoreBookmarkRequest = Static<typeof RestoreBookmarkRequestSchema>;

/** POST /v2/bookmarks/order → 200 { bookmarks }：按 ids 的先后重排；没列到的排在后面、相互顺序不变。 */
export const OrderBookmarksRequestSchema = Type.Object(
  { requestId: RequestIdSchema, ids: Type.Array(IdSchema, { minItems: 1, maxItems: BOOKMARK_ORDER_MAX }) },
  STRICT,
);
export type OrderBookmarksRequest = Static<typeof OrderBookmarksRequestSchema>;

export const ImportBookmarkItemSchema = Type.Object(
  {
    title: Type.String({ maxLength: BOOKMARK_TITLE_MAX }),
    url: Target,
    /** 原来的文件夹由 Plasticine 对到项目上、用户确认过；null = 没归项目。 */
    projectId: OrNull(IdSchema),
  },
  STRICT,
);
export type ImportBookmarkItem = Static<typeof ImportBookmarkItemSchema>;

/** POST /v2/bookmarks/import → 200：已经有的网址跳过，不是 http(s) 的跳过。 */
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
