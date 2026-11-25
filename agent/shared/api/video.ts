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
export const VIDEO_STAGES = ['synced', 'previewed', 'transcribed', 'summarized'] as const;
export type VideoStage = (typeof VIDEO_STAGES)[number];
export const VIDEO_STAGE_LABELS: Readonly<Record<VideoStage, string>> = {
  synced: '已同步',
  previewed: '已预览',
  transcribed: '已转写',
  summarized: '已总结',
};
export const VIDEO_WANTS = ['none', 'full'] as const;
export const VIDEO_RUNS = ['idle', 'queued', 'waiting_mac', 'running', 'failed'] as const;
export type VideoRun = (typeof VIDEO_RUNS)[number];
export const VIDEO_VIEW_RUNS = [...VIDEO_RUNS, 'waiting_transcriber'] as const;
export const VIDEO_KINDS = ['video', 'images'] as const;

export const DOUYIN_WORKS_PER_REPORT_MAX = 200;
export const VIDEO_TITLE_MAX_CHARS = 1_000;
export const VIDEO_CAPTION_MAX_CHARS = 5_000;
export const VIDEO_IMAGES_MAX = 12;
const LinkSchema = Type.String({ pattern: '^https://', maxLength: 4_000 });
export const DouyinWorkIdSchema = Type.String({ pattern: '^[0-9]{6,30}$' });

export const VideoDigestSchema = Type.Object({
  images: Type.Optional(Type.Array(Type.Object({
    asset: Type.String({ pattern: '^[a-f0-9]{64}\\.(png|jpg|gif|webp)$' }),
    seconds: OrNull(Type.Number({ minimum: 0 })),
  }, { additionalProperties: false }), { maxItems: VIDEO_IMAGES_MAX })),
  summary: Type.String({ maxLength: 2_000 }),
  outline: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  points: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
  related: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 5 }),
}, { additionalProperties: false });
export type VideoDigest = Static<typeof VideoDigestSchema>;

export const VideoPreviewSchema = Type.Object({
  ...VideoDigestSchema.properties,
  enough: Type.Boolean(),
}, { additionalProperties: false });
export type VideoPreview = Static<typeof VideoPreviewSchema>;

export const VideoTimingSchema = Type.Object({
  engine: Type.String({ maxLength: 100 }),
  downloadMs: OrNull(Type.Integer({ minimum: 0 })),
  transcribeMs: OrNull(Type.Integer({ minimum: 0 })),
  peakMb: OrNull(Type.Number({ minimum: 0 })),
  audioSeconds: OrNull(Type.Number({ minimum: 0 })),
  leveled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type VideoTiming = Static<typeof VideoTimingSchema>;

export const VIDEO_SHORT_TITLE_CHARS = 40;
export function shortVideoTitle(text: string): string {
  const line = (text.split('\n').find((part) => part.replace(/#\S+/gu, '').trim() !== '') ?? '')
    .replace(/#\S+/gu, '').replace(/\s+/gu, ' ').trim();
  const sentence = line.match(/^.+?[。！？!?]/u)?.[0] ?? line;
  const chars = Array.from(sentence.length >= 4 ? sentence : line);
  return chars.length > VIDEO_SHORT_TITLE_CHARS ? `${chars.slice(0, VIDEO_SHORT_TITLE_CHARS - 1).join('')}…`
    : chars.join('');
}

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
  coverUrl: OrNull(Type.String()),
  folderIds: Type.Array(Type.String()),
  stage: Type.Enum(VIDEO_STAGES),
  want: Type.Enum(VIDEO_WANTS),
  run: Type.Enum(VIDEO_VIEW_RUNS),
  error: OrNull(Type.String()),
  feedItemId: OrNull(IdSchema),
  spaceId: Type.Optional(OrNull(IdSchema)),
  version: Type.Integer({ minimum: 1 }),
});
export type VideoWorkView = Static<typeof VideoWorkViewSchema>;

export const DouyinFolderViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  count: OrNull(Type.Integer({ minimum: 0 })),
});
export type DouyinFolderView = Static<typeof DouyinFolderViewSchema>;

export const DOUYIN_PHASES = ['todo', 'done'] as const;
export type DouyinPhaseFilter = (typeof DOUYIN_PHASES)[number];

export const DouyinListQuerySchema = Type.Object({
  folder: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  q: Type.Optional(Type.String({ maxLength: 200 })),
  phase: Type.Optional(Type.Enum(DOUYIN_PHASES)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type DouyinListQuery = Static<typeof DouyinListQuerySchema>;

export const DouyinSyncViewSchema = Type.Object({
  lastAt: OrNull(IsoTimeSchema),
  state: Type.Enum(['idle', 'waiting_mac', 'running', 'failed']),
  error: OrNull(Type.String()),
});
export type DouyinSyncView = Static<typeof DouyinSyncViewSchema>;

export const DouyinListResponseSchema = Type.Object({
  works: Type.Array(VideoWorkViewSchema),
  total: Type.Integer({ minimum: 0 }),
  counts: Type.Object({
    all: Type.Integer({ minimum: 0 }),
    todo: Type.Integer({ minimum: 0 }),
    done: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  nextOffset: NextOffsetSchema,
  folders: Type.Array(DouyinFolderViewSchema),
  sync: DouyinSyncViewSchema,
  macOnline: Type.Boolean(),
});
export type DouyinListResponse = Static<typeof DouyinListResponseSchema>;

export const DouyinSyncRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  full: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type DouyinSyncRequest = Static<typeof DouyinSyncRequestSchema>;
export const DouyinSyncResponseSchema = Type.Object({ sync: DouyinSyncViewSchema });
export type DouyinSyncResponse = Static<typeof DouyinSyncResponseSchema>;

export const DouyinProcessRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  ids: Type.Optional(Type.Array(IdSchema, { maxItems: 500 })),
  folder: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
}, { additionalProperties: false });
export type DouyinProcessRequest = Static<typeof DouyinProcessRequestSchema>;
export const DouyinProcessResponseSchema = Type.Object({
  works: Type.Array(VideoWorkViewSchema),
  queued: Type.Integer({ minimum: 0 }),
});
export type DouyinProcessResponse = Static<typeof DouyinProcessResponseSchema>;

export const TRANSCRIBER_PATH = `${VIDEO_PATH}/transcriber`;
export const TRANSCRIBER_INSTALL_PATH = `${TRANSCRIBER_PATH}/install`;
export const TRANSCRIBER_STATES = ['ready', 'absent', 'installing', 'failed', 'unsupported'] as const;
export const TranscriberStatusSchema = Type.Object({
  state: Type.Enum(TRANSCRIBER_STATES),
  source: OrNull(Type.Enum(['env', 'kit'])),
  totalBytes: Type.Integer({ minimum: 0 }),
  doneBytes: Type.Integer({ minimum: 0 }),
  step: OrNull(Type.Enum(['download', 'unpack'])),
  error: OrNull(Type.String()),
}, { additionalProperties: false });
export type TranscriberStatus = Static<typeof TranscriberStatusSchema>;
export const TranscriberResponseSchema = Type.Object({ status: TranscriberStatusSchema });
export type TranscriberResponse = Static<typeof TranscriberResponseSchema>;
export const TranscriberInstallRequestSchema = Type.Object({ requestId: RequestIdSchema },
  { additionalProperties: false });
export type TranscriberInstallRequest = Static<typeof TranscriberInstallRequestSchema>;
export const TranscriberChangedEventSchema = Type.Object({
  type: Type.Literal('transcriber_changed'),
  status: TranscriberStatusSchema,
});

export const DouyinListJobSchema = Type.Object({
  id: IdSchema,
  kind: Type.Literal('list'),
  sinceIds: Type.Array(DouyinWorkIdSchema, { maxItems: 50 }),
  full: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const DouyinResolveJobSchema = Type.Object({
  id: IdSchema,
  kind: Type.Literal('resolve'),
  workId: DouyinWorkIdSchema,
  url: Type.String(),
}, { additionalProperties: false });
export const DouyinJobSchema = Type.Union([DouyinListJobSchema, DouyinResolveJobSchema]);
export type DouyinJob = Static<typeof DouyinJobSchema>;

export const DouyinJobsResponseSchema = Type.Object({ jobs: Type.Array(DouyinJobSchema) });
export type DouyinJobsResponse = Static<typeof DouyinJobsResponseSchema>;

export const DouyinListedWorkSchema = Type.Object({
  workId: DouyinWorkIdSchema,
  title: Type.String({ maxLength: VIDEO_TITLE_MAX_CHARS }),
  caption: Type.String({ maxLength: VIDEO_CAPTION_MAX_CHARS }),
  author: OrNull(Type.String({ maxLength: 200 })),
  kind: OrNull(Type.Enum(VIDEO_KINDS)),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
  collectedAt: OrNull(IsoTimeSchema),
  publishedAt: Type.Optional(OrNull(IsoTimeSchema)),
  coverUrl: Type.Optional(OrNull(LinkSchema)),
  listPosition: Type.Optional(Type.Integer({ minimum: 0, maximum: 999_999 })),
  folderIds: Type.Array(Type.String({ maxLength: 60 }), { maxItems: 50 }),
}, { additionalProperties: false });
export type DouyinListedWork = Static<typeof DouyinListedWorkSchema>;

export const DouyinSubtitleSchema = Type.Object({
  lang: Type.String({ maxLength: 20 }),
  url: LinkSchema,
  format: Type.Enum(['srt', 'vtt', 'json']),
}, { additionalProperties: false });

export const DouyinResolvedSchema = Type.Object({
  workId: DouyinWorkIdSchema,
  kind: Type.Enum(VIDEO_KINDS),
  caption: Type.String({ maxLength: VIDEO_CAPTION_MAX_CHARS }),
  videoUrl: OrNull(LinkSchema),
  images: Type.Array(LinkSchema, { maxItems: 40 }),
  subtitles: Type.Array(DouyinSubtitleSchema, { maxItems: 10 }),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
export type DouyinResolved = Static<typeof DouyinResolvedSchema>;

export const DOUYIN_ERRORS = ['signed_out', 'layout_changed', 'load_failed', 'not_found'] as const;

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

export const VIDEO_PARSE_TOOL = 'video_parse';
export const TRANSCRIBE_LEVELINGS = ['on', 'off', 'auto'] as const;

export const LevelingSchema = Type.Enum(TRANSCRIBE_LEVELINGS, { description: '转写前拉不拉平音量：on 拉平（声音轻、'
  + '远、闷，如手机放包里、会场录的）、off 不拉平、auto 先量音量太轻才拉平。上次转出来空白多、句子碎就换一档再转' });

export const VideoParseArgsSchema = Type.Object({
  url: Type.String({ minLength: 8, maxLength: 4_000, description: '视频或图文作品的链接（http/https）' }),
  wait: Type.Optional(Type.Boolean({ description: '等它做完再回（后台线里用；默认 true）' })),
  leveling: Type.Optional(Type.Enum(TRANSCRIBE_LEVELINGS, { description: '本地转写前拉不拉平音量（默认抖音 off、'
    + '别的 auto）；只对还没转写的生效' })),
}, { additionalProperties: false });
