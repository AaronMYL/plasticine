// 信息流里 X 上他关注的人（第 3 批，用户 11-04 定）：用他在 Plasticine 浏览器里的 X 登录，Mac 在线时定时读「关注」
// 时间线。Mac App 按这个口径实现（mac/Sources/Plasticine/x-timeline-reader.swift）：
//   GET  /v2/nodes/feed/x（节点 Bearer）→ { due, everyMinutes }：到没到读的时候（来源关着就永远不到）；
//   POST /v2/nodes/feed/x（节点 Bearer）{ requestId, posts, error } → { added }：读到的帖子交给服务端入库，
//        没读到就只给 error（没登录 / X 改版取不到 / 页面没打开），设置里那一行写原因，不弹卡。
// Mac 不在线就没人来问，也就不读；登录状态只在 Mac 上，不进服务器。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_IMAGE_RATIO_MAX, FEED_IMAGE_RATIO_MIN, FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_X_PATH = `${API_PREFIX}/nodes/feed/x`;

/** 一次最多交多少条：「关注」时间线往下翻两三屏大约 30–60 条。 */
export const X_POSTS_MAX = 100;
/** 一条帖子正文最多多少字（X 长帖 25 000 字，信息流卡片只要前面这些）。 */
export const X_TEXT_MAX_CHARS = 4_000;

const HttpsSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });

export const XPostSchema = Type.Object({
  /** 帖子的数字标识（链接里 /status/ 后面那一段）。 */
  id: Type.String({ pattern: '^[0-9]{1,30}$' }),
  /** 不带 @ 的用户名。 */
  handle: Type.String({ pattern: '^[A-Za-z0-9_]{1,30}$' }),
  author: Type.String({ minLength: 1, maxLength: 200 }),
  avatar: OrNull(HttpsSchema),
  text: Type.String({ maxLength: X_TEXT_MAX_CHARS }),
  /** 帖子里的第一张图。 */
  image: OrNull(HttpsSchema),
  /** 那张图的高 / 宽；量不到就是 null。 */
  imageRatio: OrNull(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX })),
  publishedAt: OrNull(IsoTimeSchema),
}, { additionalProperties: false });
export type XPost = Static<typeof XPostSchema>;

export const X_READ_ERRORS = ['signed_out', 'layout_changed', 'load_failed'] as const;

export const XTimelineReportSchema = Type.Object({
  requestId: RequestIdSchema,
  posts: Type.Array(XPostSchema, { maxItems: X_POSTS_MAX }),
  error: OrNull(Type.Object({
    code: Type.Enum(X_READ_ERRORS),
    /** 补一句具体原因（载入失败的系统说法），不带网址。 */
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
