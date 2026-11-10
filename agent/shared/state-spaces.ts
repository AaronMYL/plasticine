// 空间与订阅（《优化清单》第 6、7 条，用户 11-06 定，11-07 补；第 8 批第 6 条 11-09 改）。
// 空间：Plasticine 写的都是空间。11-09 起空间是整页网页，两种体裁：报告（按内容自由排版）和来信（固定信纸，模型只写
// 正文）；存的是 body 里的正文片段（html），版式底子由显示的一端套上。旧的结构化文档（doc）留给历史：重写成网页以前的
// 版本还在 space_revisions 里。图表只能用存下来的数据画、要写来源；图片要写来源；自己整理的数据要写依据。
// 订阅：任务和产物分开。订阅本身就是任务设置（关注范围、信息源、筛选标准、执行时间、输出要求），每一期是一个空间。
// 个人回顾也是一个订阅（kind review），日报每天早上、周报周日晚上。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const SPACE_TITLE_MAX_CHARS = 120;
export const SPACE_TEXT_MAX_CHARS = 40_000;
// 一个空间最多这么多块：再长就该拆成几个空间。
export const SPACE_BLOCKS_MAX = 400;
// 结论下面一排数字卡（设计稿 Library-Space 是三张）。
export const SPACE_STATS_MAX = 4;
// 一张图最多这么多个点：再多就看不清了，也说明数据没整理。
export const SPACE_CHART_POINTS_MAX = 120;
// 一页的正文片段最多这么长（报告里内联的 SVG 图表占得多；插图存成资产，不内联）。
export const SPACE_HTML_MAX_CHARS = 500_000;
export const SPACE_AUTHORS = ['user', 'ai'] as const;
export type SpaceAuthor = (typeof SPACE_AUTHORS)[number];

/** 一条结论能点回去的地方：原对话（line:<线>:<seq>）、线、项目、记忆文档、笔记、别的空间、信息流条目。 */
export const SPACE_LINK_KINDS = ['message', 'line', 'project', 'memory_doc', 'note', 'space', 'feed_item'] as const;
export type SpaceLinkKind = (typeof SPACE_LINK_KINDS)[number];
export const SpaceLinkSchema = Type.Object({ kind: Type.Enum(SPACE_LINK_KINDS), id: IdSchema }, STRICT);
export type SpaceLink = Static<typeof SpaceLinkSchema>;

/** 出处：一句说法（「论文表 2（18 人）」），可带原文网址或站内链接。 */
export const SpaceSourceSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 300 }),
  url: Type.Optional(Type.String({ minLength: 1, maxLength: 2000, pattern: '^https?://' })),
  link: Type.Optional(SpaceLinkSchema),
}, STRICT);
export type SpaceSource = Static<typeof SpaceSourceSchema>;

const Text = Type.String({ minLength: 1, maxLength: SPACE_TEXT_MAX_CHARS });

/** 小节标题：右侧目录就是这些。id 是锚点。 */
export const SpaceHeadingSchema = Type.Object({
  type: Type.Literal('heading'),
  id: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' }),
  text: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);

/** 一段正文（Markdown）；[^n] 指向 doc.sources 的第 n 条。 */
export const SpaceTextSchema = Type.Object({ type: Type.Literal('text'), markdown: Text }, STRICT);

export const SPACE_CHART_KINDS = ['line', 'bar'] as const;
export const SpaceChartSchema = Type.Object({
  type: Type.Literal('chart'),
  kind: Type.Enum(SPACE_CHART_KINDS),
  /** 读屏名字：这张图画的是什么。 */
  title: Type.String({ minLength: 1, maxLength: 200 }),
  x: Type.Array(Type.Union([Type.String({ maxLength: 40 }), Type.Number()]),
    { minItems: 1, maxItems: SPACE_CHART_POINTS_MAX }),
  series: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    values: Type.Array(Type.Number(), { minItems: 1, maxItems: SPACE_CHART_POINTS_MAX }),
  }, STRICT), { minItems: 1, maxItems: 4 }),
  /** 纵轴单位（「%」「篇」）。 */
  unit: Type.Optional(Type.String({ maxLength: 12 })),
  /** 图下那一行：横轴 → 纵轴是什么。 */
  caption: Type.String({ minLength: 1, maxLength: 300 }),
  source: SpaceSourceSchema,
  /** 自己整理的数据（不是原文里现成的）：怎么整理出来的。 */
  basis: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, STRICT);
export type SpaceChart = Static<typeof SpaceChartSchema>;

export const SpaceImageSchema = Type.Object({
  type: Type.Literal('image'),
  url: Type.String({ minLength: 1, maxLength: 2000, pattern: '^(https?://|/)' }),
  alt: Type.String({ minLength: 1, maxLength: 300 }),
  caption: Type.Optional(Type.String({ maxLength: 300 })),
  source: SpaceSourceSchema,
}, STRICT);

export const SpaceQuoteSchema = Type.Object({
  type: Type.Literal('quote'),
  text: Type.String({ minLength: 1, maxLength: 4000 }),
  source: SpaceSourceSchema,
}, STRICT);

export const SpaceBlockSchema = Type.Union([SpaceHeadingSchema, SpaceTextSchema, SpaceChartSchema, SpaceImageSchema,
  SpaceQuoteSchema]);
export type SpaceBlock = Static<typeof SpaceBlockSchema>;

export const SpaceStatSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 16 }),
  label: Type.String({ minLength: 1, maxLength: 40 }),
}, STRICT);

/** 空间的正文：可以只有文字，也可以带结论大标题、数字卡、目录（小节标题）、图表、图片、引用。 */
export const SpaceDocSchema = Type.Object({
  /** 大标题上面那一小行（「第 2 期 · 11月2日–11月8日」）。 */
  kicker: Type.Optional(Type.String({ maxLength: 80 })),
  /** 结论大标题；没有就用空间标题。 */
  headline: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  stats: Type.Array(SpaceStatSchema, { maxItems: SPACE_STATS_MAX }),
  blocks: Type.Array(SpaceBlockSchema, { maxItems: SPACE_BLOCKS_MAX }),
  /** 正文里 [^n] 的出处。 */
  sources: Type.Array(SpaceSourceSchema, { maxItems: 200 }),
}, STRICT);
export type SpaceDoc = Static<typeof SpaceDocSchema>;

/** 体裁：报告（按内容自由排版）、来信（固定信纸）。旧空间重写成网页以前是 null（照旧按 doc 显示）。 */
export const SPACE_GENRES = ['report', 'letter'] as const;
export type SpaceGenre = (typeof SPACE_GENRES)[number];
const Html = Type.String({ minLength: 1, maxLength: SPACE_HTML_MAX_CHARS });

/** 网页版之前的空间没有正文文档：新写的空间 doc 存这个空的。 */
export const EMPTY_SPACE_DOC: SpaceDoc = { stats: [], blocks: [], sources: [] };

/** review 的两种：日报、周报；研究周报和一般空间是 null。 */
export const SPACE_EDITIONS = ['daily', 'weekly'] as const;
export type SpaceEdition = (typeof SPACE_EDITIONS)[number];

/** 资料库分类和来源，独立于报告 / 来信的显示体裁。 */
export const SPACE_CATEGORIES = ['report', 'letter', 'webarchive', 'booknote'] as const;
export const SpaceMetadataSchema = Type.Object({
  category: Type.Enum(SPACE_CATEGORIES),
  sourceUrl: Nullable(Type.String({ minLength: 1, maxLength: 2000, pattern: '^(https?://|#/|book:)' })),
  bookId: Nullable(IdSchema),
  folder: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
}, STRICT);
export type SpaceMetadata = Static<typeof SpaceMetadataSchema>;

export const SpaceInputSchema = Type.Object({
  ...Type.Partial(SpaceMetadataSchema).properties,
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  /** 旧版的结构化正文；网页版的空间是空的（EMPTY_SPACE_DOC）。 */
  doc: SpaceDocSchema,
  genre: Type.Optional(Nullable(Type.Enum(SPACE_GENRES))),
  /** body 里的正文片段（清洗过）；旧空间重写以前是 null。 */
  html: Type.Optional(Nullable(Html)),
  author: Type.Enum(SPACE_AUTHORS),
  subscriptionId: Type.Optional(Nullable(IdSchema)),
  issueNumber: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
  edition: Type.Optional(Nullable(Type.Enum(SPACE_EDITIONS))),
  /** 从笔记迁来的那一篇（11-07：「Plasticine 写的」文件夹整体迁成空间）。 */
  sourceNoteId: Type.Optional(Nullable(IdSchema)),
}, STRICT);
export type SpaceInput = Static<typeof SpaceInputSchema>;

export const SpaceSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(SpaceInputSchema).properties,
  deletedAt: Nullable(IsoTimeSchema),
}, STRICT);
export type Space = Static<typeof SpaceSchema>;

/**
 * 一版：每次保存一行。change 是这一版改了什么（「图从 4 张减到 1 张」），rule 是 Plasticine 提的「以后都这样」
 * （「每期最多 1 张图」）：只改这一期，点了「以后都这样」才写进订阅设置。
 */
export const SpaceRevisionSchema = Type.Object({
  spaceId: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  doc: SpaceDocSchema,
  genre: Nullable(Type.Enum(SPACE_GENRES)),
  html: Nullable(Html),
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  author: Type.Enum(SPACE_AUTHORS),
  savedAt: IsoTimeSchema,
  change: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  rule: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  /** 撤销时恢复到的那一版。 */
  restoredFrom: Nullable(Type.Integer({ minimum: 1 })),
}, STRICT);
export type SpaceRevision = Static<typeof SpaceRevisionSchema>;

// ---------- 订阅 ----------

export const SUBSCRIPTION_KINDS = ['research', 'review'] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];
/** draft 草案（还没出过）；sample 出过样刊、还没开定时；active 按时出；paused 暂停。 */
export const SUBSCRIPTION_STATUSES = ['draft', 'sample', 'active', 'paused'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const Clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });
/** 0 = 星期日（和 Date.getDay 一样）。 */
const Weekday = Type.Integer({ minimum: 0, maximum: 6 });

export const SubscriptionScheduleSchema = Type.Object({
  every: Type.Enum(['day', 'week']),
  weekday: Type.Optional(Weekday),
  time: Clock,
}, STRICT);
export type SubscriptionSchedule = Static<typeof SubscriptionScheduleSchema>;

/** 「以后都这样」：一条长期规则，记着是哪一期加的。 */
export const SubscriptionRuleSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 200 }),
  fromIssue: Nullable(Type.Integer({ minimum: 1 })),
  addedAt: IsoTimeSchema,
}, STRICT);
export type SubscriptionRule = Static<typeof SubscriptionRuleSchema>;

const Labels = (max: number) => Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: max });

export const ResearchSettingsSchema = Type.Object({
  kind: Type.Literal('research'),
  /** 关注范围。 */
  topics: Labels(20),
  /** 基础研究还是临床应用；没定是 null。 */
  focus: Nullable(Type.Enum(['basic', 'clinical'])),
  /** 专业还是科普。 */
  depth: Nullable(Type.Enum(['expert', 'popular'])),
  /** 信息源。 */
  sources: Labels(20),
  /** 预印本：不收 / 收但标出来 / 照常收。 */
  preprints: Type.Enum(['skip', 'mark', 'include']),
  /** 筛选标准（一句话，可空）。 */
  filter: Type.String({ maxLength: 500 }),
  schedule: SubscriptionScheduleSchema,
  /** 每期写什么（结构）。 */
  sections: Labels(10),
  /** 输出要求（一句话，可空）。 */
  output: Type.String({ maxLength: 500 }),
  rules: Type.Array(SubscriptionRuleSchema, { maxItems: 50 }),
}, STRICT);
export type ResearchSettings = Static<typeof ResearchSettingsSchema>;

/** 回顾不参考的东西：某条线、某个项目、某份记忆文档、某个信息源。 */
export const ReviewExcludeSchema = Type.Object({
  kind: Type.Enum(['line', 'project', 'memory_doc', 'feed_source']),
  id: IdSchema,
  label: Type.String({ minLength: 1, maxLength: 120 }),
}, STRICT);
export type ReviewExclude = Static<typeof ReviewExcludeSchema>;

export const ReviewSettingsSchema = Type.Object({
  kind: Type.Literal('review'),
  daily: Type.Object({ on: Type.Boolean(), time: Clock }, STRICT),
  weekly: Type.Object({ on: Type.Boolean(), weekday: Weekday, time: Clock }, STRICT),
  /** 明确关注的主题（兴趣里排第一）。 */
  topics: Labels(20),
  /** 外部新信息看哪些来源（空 = 按关注点的信息流）。 */
  sources: Labels(20),
  exclude: Type.Array(ReviewExcludeSchema, { maxItems: 200 }),
  rules: Type.Array(SubscriptionRuleSchema, { maxItems: 50 }),
}, STRICT);
export type ReviewSettings = Static<typeof ReviewSettingsSchema>;

export const SubscriptionSettingsSchema = Type.Union([ResearchSettingsSchema, ReviewSettingsSchema]);
export type SubscriptionSettings = Static<typeof SubscriptionSettingsSchema>;

export const SubscriptionInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  kind: Type.Enum(SUBSCRIPTION_KINDS),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  settings: SubscriptionSettingsSchema,
  /** 按他所在地的时区（IANA）。 */
  timeZone: Type.String({ minLength: 1, maxLength: 64 }),
}, STRICT);
export type SubscriptionInput = Static<typeof SubscriptionInputSchema>;

export const SubscriptionPatchSchema = Type.Partial(Type.Object({
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  settings: SubscriptionSettingsSchema,
  timeZone: Type.String({ minLength: 1, maxLength: 64 }),
  lineId: Nullable(IdSchema),
  lastRunAt: Nullable(IsoTimeSchema),
}), STRICT);
export type SubscriptionPatch = Static<typeof SubscriptionPatchSchema>;

export const SubscriptionSchema = Type.Object({
  ...RECORD_META,
  ...SubscriptionInputSchema.properties,
  /** 每期往这一条后台线里放一条消息；还没出过是 null。 */
  lineId: Nullable(IdSchema),
  lastRunAt: Nullable(IsoTimeSchema),
}, STRICT);
export type Subscription = Static<typeof SubscriptionSchema>;
