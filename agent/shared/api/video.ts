// 视频解析与抖音收藏（《优化清单》第 9 条，用户 11-06 定、11-07 改）。
//
// 视频解析是一个通用技能：任何视频链接（对话里贴的、网页上的、信息流里的）都交给它，产出逐字稿 + 大纲、核心观点、
// 和他兴趣有关的重点；图文作品读图片里的文字，结合配文一起总结。下载、抽音频、转写都在本体所在的机器上做。
//
// 抖音收藏：他有 1000 多条，平时偶尔收藏，所以不全量处理——同步只拿标题、作者、收藏时间、链接；他勾选或指定收藏夹
// 才处理；先用标题和配文做低成本预览，不够再取字幕或转写。每条一个状态：已同步 → 已预览 → 已转写 → 已总结；
// 按作品 ID 去重，处理过的不重复。
//
// 要登录的网站（抖音）靠他 Mac 上 Plasticine 浏览器里已登录的状态取：服务端排一件「Mac 要做的事」，Mac 在线时来取
// （GET /v2/nodes/douyin），做完交回（POST /v2/nodes/douyin）。Mac 不在线就一直排着，上线再取。登录状态只在 Mac 上，
// 不进服务器；交回来的下载地址只用来在服务器上下载这一次，不进日志。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { NextOffsetSchema, OrNull } from './lineage.ts';

export const VIDEO_PATH = `${API_PREFIX}/video`;
export const DOUYIN_PATH = `${VIDEO_PATH}/douyin`;
export const DOUYIN_SYNC_PATH = `${DOUYIN_PATH}/sync`;
export const DOUYIN_PROCESS_PATH = `${DOUYIN_PATH}/process`;
export const DOUYIN_NODE_PATH = `${API_PREFIX}/nodes/douyin`;

export const VIDEO_PLATFORMS = ['douyin', 'web'] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];
/** 一条走到哪了：已同步 → 已预览 → 已转写 → 已总结。只往前走。 */
export const VIDEO_STAGES = ['synced', 'previewed', 'transcribed', 'summarized'] as const;
export type VideoStage = (typeof VIDEO_STAGES)[number];
export const VIDEO_STAGE_LABELS: Readonly<Record<VideoStage, string>> = {
  synced: '已同步',
  previewed: '已预览',
  transcribed: '已转写',
  summarized: '已总结',
};
/** 他要它走到哪：none 只同步了标题；full 预览后不够就转写、再总结。 */
export const VIDEO_WANTS = ['none', 'full'] as const;
/** 现在在不在动：排着、等 Mac 取下载地址、在跑、没做成。 */
export const VIDEO_RUNS = ['idle', 'queued', 'waiting_mac', 'running', 'failed'] as const;
export type VideoRun = (typeof VIDEO_RUNS)[number];
export const VIDEO_KINDS = ['video', 'images'] as const;
export const TRANSCRIPT_SOURCES = ['caption', 'subtitle', 'local', 'images'] as const;

/** 一次最多交多少条（Mac 翻收藏一页 10–20 条，攒几页交一次）。 */
export const DOUYIN_WORKS_PER_REPORT_MAX = 200;
export const VIDEO_TITLE_MAX_CHARS = 1_000;
export const VIDEO_CAPTION_MAX_CHARS = 5_000;
/** 图文作品最多读这么多张图（抖音图文最多 35 张；多了只读前面的，模型输入有限）。 */
export const VIDEO_IMAGES_MAX = 12;
const LinkSchema = Type.String({ pattern: '^https://', maxLength: 4_000 });
/** 抖音作品 ID（aweme_id）是一串数字。 */
export const DouyinWorkIdSchema = Type.String({ pattern: '^[0-9]{6,30}$' });

export const VideoDigestSchema = Type.Object({
  /** 一两句话说这条讲了什么。 */
  summary: Type.String({ maxLength: 2_000 }),
  /** 大纲：按顺序的几段。 */
  outline: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  /** 核心观点。 */
  points: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
  /** 和他兴趣有关的重点（没有就是空）。 */
  related: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 5 }),
}, { additionalProperties: false });
export type VideoDigest = Static<typeof VideoDigestSchema>;

/** 预览：只看标题和配文。enough = 配文已经说清楚了，不用再转写。 */
export const VideoPreviewSchema = Type.Object({
  ...VideoDigestSchema.properties,
  enough: Type.Boolean(),
}, { additionalProperties: false });
export type VideoPreview = Static<typeof VideoPreviewSchema>;

/** 一次转写的实测：用来排后台并发和写进说明（docs/specs/video-parse.md）。 */
export const VideoTimingSchema = Type.Object({
  engine: Type.String({ maxLength: 100 }),
  downloadMs: OrNull(Type.Integer({ minimum: 0 })),
  transcribeMs: OrNull(Type.Integer({ minimum: 0 })),
  /** 转写进程的峰值内存（MB）。 */
  peakMb: OrNull(Type.Number({ minimum: 0 })),
  audioSeconds: OrNull(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
export type VideoTiming = Static<typeof VideoTimingSchema>;

export const VideoWorkViewSchema = Type.Object({
  id: IdSchema,
  platform: Type.Enum(VIDEO_PLATFORMS),
  workId: Type.String(),
  url: Type.String(),
  kind: OrNull(Type.Enum(VIDEO_KINDS)),
  title: Type.String(),
  author: OrNull(Type.String()),
  collectedAt: OrNull(IsoTimeSchema),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
  folderIds: Type.Array(Type.String()),
  stage: Type.Enum(VIDEO_STAGES),
  want: Type.Enum(VIDEO_WANTS),
  run: Type.Enum(VIDEO_RUNS),
  /** 没做成的一句话原因。 */
  error: OrNull(Type.String()),
  feedItemId: OrNull(IdSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type VideoWorkView = Static<typeof VideoWorkViewSchema>;

export const DouyinFolderViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  count: OrNull(Type.Integer({ minimum: 0 })),
});
export type DouyinFolderView = Static<typeof DouyinFolderViewSchema>;

/** GET /v2/video/douyin?folder=&q=&limit=&offset= — 收藏，按抖音收藏列表顺序。 */
export const DouyinListQuerySchema = Type.Object({
  folder: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  q: Type.Optional(Type.String({ maxLength: 200 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type DouyinListQuery = Static<typeof DouyinListQuerySchema>;

export const DouyinSyncViewSchema = Type.Object({
  /** 上一次同步完成的时间；还没同步过是 null。 */
  lastAt: OrNull(IsoTimeSchema),
  /** 这一次同步：等 Mac 上线来取、Mac 正在翻、没做成。 */
  state: Type.Enum(['idle', 'waiting_mac', 'running', 'failed']),
  error: OrNull(Type.String()),
});
export type DouyinSyncView = Static<typeof DouyinSyncViewSchema>;

export const DouyinListResponseSchema = Type.Object({
  works: Type.Array(VideoWorkViewSchema),
  /** 符合筛选的总条数（「还有 n 条」）。 */
  total: Type.Integer({ minimum: 0 }),
  nextOffset: NextOffsetSchema,
  folders: Type.Array(DouyinFolderViewSchema),
  sync: DouyinSyncViewSchema,
  /** Mac 在不在线：不在线时取地址的活排着。 */
  macOnline: Type.Boolean(),
});
export type DouyinListResponse = Static<typeof DouyinListResponseSchema>;

/** POST /v2/video/douyin/sync → 202 { sync }：排一次同步，Mac 在线就去翻收藏列表。 */
export const DouyinSyncRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  /** 全量回填收藏顺序，不触发作品解析。 */
  full: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type DouyinSyncRequest = Static<typeof DouyinSyncRequestSchema>;
export const DouyinSyncResponseSchema = Type.Object({ sync: DouyinSyncViewSchema });
export type DouyinSyncResponse = Static<typeof DouyinSyncResponseSchema>;

/** POST /v2/video/douyin/process → 202 { works }：处理他勾选的（或整个收藏夹）；处理过的不重复。 */
export const DouyinProcessRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  ids: Type.Optional(Type.Array(IdSchema, { maxItems: 500 })),
  folder: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
}, { additionalProperties: false });
export type DouyinProcessRequest = Static<typeof DouyinProcessRequestSchema>;
export const DouyinProcessResponseSchema = Type.Object({
  works: Type.Array(VideoWorkViewSchema),
  /** 这次真正排上的条数（处理过的、在跑的不算）。 */
  queued: Type.Integer({ minimum: 0 }),
});
export type DouyinProcessResponse = Static<typeof DouyinProcessResponseSchema>;

// ---------- Mac 这一头（节点 Bearer） ----------

/** 翻收藏：sinceIds 是已经同步过的最新几条，翻到它们就可以停（新收藏在前）。 */
export const DouyinListJobSchema = Type.Object({
  id: IdSchema,
  kind: Type.Literal('list'),
  sinceIds: Type.Array(DouyinWorkIdSchema, { maxItems: 50 }),
  full: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
/** 取一条作品的下载地址（视频地址、图文的图片、自带字幕）。 */
export const DouyinResolveJobSchema = Type.Object({
  id: IdSchema,
  kind: Type.Literal('resolve'),
  workId: DouyinWorkIdSchema,
  url: Type.String(),
}, { additionalProperties: false });
export const DouyinJobSchema = Type.Union([DouyinListJobSchema, DouyinResolveJobSchema]);
export type DouyinJob = Static<typeof DouyinJobSchema>;

/** GET /v2/nodes/douyin → { jobs }：排着的活，一次给完；取走的活标成在做，交回或超时再排。 */
export const DouyinJobsResponseSchema = Type.Object({ jobs: Type.Array(DouyinJobSchema) });
export type DouyinJobsResponse = Static<typeof DouyinJobsResponseSchema>;

export const DouyinListedWorkSchema = Type.Object({
  workId: DouyinWorkIdSchema,
  title: Type.String({ maxLength: VIDEO_TITLE_MAX_CHARS }),
  caption: Type.String({ maxLength: VIDEO_CAPTION_MAX_CHARS }),
  author: OrNull(Type.String({ maxLength: 200 })),
  kind: OrNull(Type.Enum(VIDEO_KINDS)),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
  /** 只有抖音明确返回的收藏时间；缺失时为 null。 */
  collectedAt: OrNull(IsoTimeSchema),
  /** 作品发布时间，仅作来源信息，不能替代收藏时间。 */
  publishedAt: Type.Optional(OrNull(IsoTimeSchema)),
  /** 总收藏列表中从 0 开始的位置；分批报告保持同一位置。 */
  listPosition: Type.Optional(Type.Integer({ minimum: 0, maximum: 999_999 })),
  folderIds: Type.Array(Type.String({ maxLength: 60 }), { maxItems: 50 }),
}, { additionalProperties: false });
export type DouyinListedWork = Static<typeof DouyinListedWorkSchema>;

export const DouyinSubtitleSchema = Type.Object({
  lang: Type.String({ maxLength: 20 }),
  url: LinkSchema,
  /** srt / vtt / json（抖音自带字幕是 json）。 */
  format: Type.Enum(['srt', 'vtt', 'json']),
}, { additionalProperties: false });

export const DouyinResolvedSchema = Type.Object({
  workId: DouyinWorkIdSchema,
  kind: Type.Enum(VIDEO_KINDS),
  caption: Type.String({ maxLength: VIDEO_CAPTION_MAX_CHARS }),
  /** 视频的无水印地址（抖音 CDN，可能绑登录或 IP，服务器上下载失败就记原因）。 */
  videoUrl: OrNull(LinkSchema),
  images: Type.Array(LinkSchema, { maxItems: 40 }),
  subtitles: Type.Array(DouyinSubtitleSchema, { maxItems: 10 }),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
export type DouyinResolved = Static<typeof DouyinResolvedSchema>;

export const DOUYIN_ERRORS = ['signed_out', 'layout_changed', 'load_failed', 'not_found'] as const;

/** POST /v2/nodes/douyin：交回一件活的结果。list 可以分几次交（done = false 表示还在翻）。 */
export const DouyinReportSchema = Type.Object({
  requestId: RequestIdSchema,
  jobId: IdSchema,
  list: Type.Optional(Type.Object({
    folders: Type.Array(DouyinFolderViewSchema, { maxItems: 200 }),
    works: Type.Array(DouyinListedWorkSchema, { maxItems: DOUYIN_WORKS_PER_REPORT_MAX }),
    done: Type.Boolean(),
  }, { additionalProperties: false })),
  resolved: Type.Optional(DouyinResolvedSchema),
  error: Type.Optional(Type.Object({
    code: Type.Enum(DOUYIN_ERRORS),
    detail: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type DouyinReport = Static<typeof DouyinReportSchema>;
export const DouyinReportResponseSchema = Type.Object({
  accepted: Type.Boolean(),
  added: Type.Integer({ minimum: 0 }),
});
export type DouyinReportResponse = Static<typeof DouyinReportResponseSchema>;

// ---------- 技能（对话、后台线、定时线都能调） ----------

export const VIDEO_PARSE_TOOL = 'video_parse';
export const VideoParseArgsSchema = Type.Object({
  url: Type.String({ minLength: 8, maxLength: 4_000, description: '视频或图文作品的链接（http/https）' }),
  wait: Type.Optional(Type.Boolean({ description: '等它做完再回（后台线里用；默认 true）' })),
}, { additionalProperties: false });
export type VideoParseArgs = Static<typeof VideoParseArgsSchema>;
