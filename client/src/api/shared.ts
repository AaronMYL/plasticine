// 接口的 schema、常量和类型只有一份，在 agent/shared/api（plasticine-code 底线第 4 条）。客户端只从这里进，
// 目录换了只改这一个文件。

export * from '../../../agent/shared/api/index.ts';
export { internalPageHash } from '../../../agent/shared/internal-page.ts';
export { bookmarkKey } from '../../../agent/shared/bookmarks.ts';
export { LEGACY_PUBLIC_URLS } from '../../../agent/shared/public-url.ts';
export * from '../../../agent/shared/reddit.ts';
export { replyExcerpt, replyMarker, splitReply, type LineReply } from '../../../agent/shared/line-reply.ts';
export {
  FEED_LONG_TEXT_CHARS,
  languageName,
  type FeedChart,
  type FeedZhView,
} from '../../../agent/shared/feed-translation.ts';
export {
  compareFeedItems,
  interestHit,
} from '../../../agent/shared/feed-order.ts';
export {
  PROJECT_HEALTHS,
  PROJECT_LIFECYCLES,
  SOURCE_WEIGHTS,
  STANDING_PROJECT_IDS,
} from '../../../agent/shared/state.ts';
// 「怎么替你做事」那份记忆文档的标识（第 4 批）：旧地址 #/memory/agreements 打开它。
export {
  RULES_DOC_ID,
} from '../../../agent/shared/state.ts';
export type { ProjectBrief, ProjectPerson } from '../../../agent/shared/state.ts';
// 书签（第 110 条）：保存的分组里的一页、上限。
export {
  BOOKMARK_GROUP_TABS_MAX,
  BOOKMARK_SNAPSHOT_MAX_CHARS,
  BOOKMARK_TITLE_MAX,
  type BookmarkTab,
} from '../../../agent/shared/state.ts';
export {
  moneyAmounts,
} from '../../../agent/shared/money-amounts.ts';
export {
  proposedAgreementText,
} from '../../../agent/shared/agreement-diff.ts';
// 图书：高亮四色、上限、大纲和重点的形状（state-books.ts）。
export {
  BOOK_CONTEXT_CHARS,
  BOOK_NOTE_MAX_CHARS,
  BOOK_QUOTE_MAX_CHARS,
  HIGHLIGHT_COLORS,
  type BookAnchor,
  type BookFormat,
  type BookInsightKind,
  type BookKeyPoint,
  type BookOutline,
  type BookOutlinePart,
  type BookTocEntry,
  type HighlightColor,
} from '../../../agent/shared/state.ts';
export {
  BRIEF_LIMIT_MAX,
  FEED_LIST_ORIGINS,
  FEED_SOURCE_LEVELS,
  INTERVIEW_PER_DAY_MAX,
  REGISTRATION_KINDS,
  RETURN_THRESHOLD_HOURS_MAX,
  DEFAULT_NOTE_FOLDER,
  DEVICE_ACTION_CLASSES,
  DEVICE_CLASS_MODES,
  DEVICE_NAME_MAX_CHARS,
  DEVICE_PER_HOUR_MAX,
  DeviceLimitsSchema,
  FOCUS_MINUTES_DEFAULT,
  FOCUS_MINUTES_MAX,
  FOCUS_MINUTES_MIN,
  MONEY_DEFAULT_CATEGORIES,
  MONEY_ACCOUNT_TYPES,
  REMINDER_SUBJECT_MAX_CHARS,
  MessageDisagreementSchema,
  PushEndpointSchema,
  PushKeysSchema,
  type AskKind,
  type AskOption,
  type DeviceActionClass,
  type DeviceClassMode,
  type DeviceLimits,
  type ReplyLayers,
} from '../../../agent/shared/state.ts';
// 空间与订阅（第 6、7 条）：空间正文的块、订阅设置的形状。
export type {
  ResearchSettings,
  ReviewSettings,
  SubscriptionSchedule,
  SpaceBlock,
  SpaceChart,
  SpaceDoc,
  SpaceGenre,
  SpaceLink,
  SpaceSource,
  Subscription,
  SubscriptionSettings,
} from '../../../agent/shared/state.ts';
// 第 8 批第 6 条：空间是整页网页（报告 / 来信）；旧版式的空间是空文档。
export { EMPTY_SPACE_DOC, SPACE_GENRES, SPACE_LINK_KINDS } from '../../../agent/shared/state.ts';
