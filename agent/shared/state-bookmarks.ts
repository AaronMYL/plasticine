// 书签（2026-11-03 用户定，第 110 条）：任何标签都能加书签——网页、Plasticine 自己的一页（笔记、书、项目……）、
// 一整组标签（「关掉，存进书签」存成的保存的分组）。信息流的「收藏」就是加书签（origin = feed，带着那一条）。
// 加书签时从这个标签存一份正文快照，⌘K 查找和对话里「我收藏过一篇讲……的」都靠它找得到。删除只记 deletedAt，行不删。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const BOOKMARK_KINDS = ['web', 'page', 'group'] as const;
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number];
/** 手加的（⌘D、☆、右键标签、关掉一组）· 信息流收藏的 · 从浏览器导出的书签 HTML 导入的。 */
export const BOOKMARK_ORIGINS = ['manual', 'feed', 'import'] as const;
export type BookmarkOrigin = (typeof BOOKMARK_ORIGINS)[number];

/** 名字最长这么多字：浏览器导出的标题偶尔很长，再长的截断。 */
export const BOOKMARK_TITLE_MAX = 500;
/** 网址或 Plasticine 内部地址（#/notes/x）最长这么多字（和网页标签同步给 Mac 的上限一致）。 */
export const BOOKMARK_TARGET_MAX = 4_096;
/** 一个保存的分组最多这么多页（和同时开着的网页标签上限一致）。 */
export const BOOKMARK_GROUP_TABS_MAX = 50;
/** 正文快照的上限：和「问这一页」带的正文同一档（mac-bridge.ts 的 WEB_PAGE_TEXT_MAX_CHARS）。 */
export const BOOKMARK_SNAPSHOT_MAX_CHARS = 100_000;

export const BookmarkTabSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('web'), Type.Literal('page')]),
    title: Type.String({ maxLength: BOOKMARK_TITLE_MAX }),
    /** 网页是网址，Plasticine 的页面是 #/… 地址。 */
    target: Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX }),
  },
  STRICT,
);
export type BookmarkTab = Static<typeof BookmarkTabSchema>;

export const BookmarkInputSchema = Type.Object(
  {
    kind: Type.Enum(BOOKMARK_KINDS),
    title: Type.String({ minLength: 1, maxLength: BOOKMARK_TITLE_MAX }),
    /** 网页的网址、页面的 #/… 地址；保存的分组是 null（页在 tabs 里）。 */
    target: Nullable(Type.String({ minLength: 1, maxLength: BOOKMARK_TARGET_MAX })),
    projectId: Type.Optional(Nullable(IdSchema)),
    tabs: Type.Optional(Type.Array(BookmarkTabSchema, { maxItems: BOOKMARK_GROUP_TABS_MAX })),
    snapshot: Type.Optional(Nullable(Type.String())),
    /** 原文有多少字；比快照长就是截断了。没有快照是 0。 */
    snapshotChars: Type.Optional(Type.Integer({ minimum: 0 })),
    origin: Type.Enum(BOOKMARK_ORIGINS),
    feedItemId: Type.Optional(Nullable(IdSchema)),
    /** 同一节里的先后：小的在前。 */
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
export type BookmarkPatch = Static<typeof BookmarkPatchSchema>;

export const BookmarkSchema = Type.Object({ ...RECORD_META, ...Type.Required(BookmarkInputSchema).properties });
export type Bookmark = Static<typeof BookmarkSchema>;
