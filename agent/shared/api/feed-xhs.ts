// 信息流里的小红书（第13批，11-14 Aaron：加「小红书」，抓首页「推荐」和自己的收藏，按时间合并、去重，标「推荐」
// 「收藏」，两处都有就两个标都留）：用他在 Plasticine 浏览器里的小红书登录，电脑客户端在线时定时读（和 X 同一个做法，
// feed-x.ts）：
//   GET  /v2/nodes/feed/xhs（节点 Bearer）→ { due, everyMinutes }：到没到读的时候（来源关着就永远不到）；
//   POST /v2/nodes/feed/xhs（节点 Bearer）{ requestId, notes, error } → { added }：读到的笔记交给服务端入库，
//        没读到就只给 error（没登录 / 要验证 / 改版取不到 / 页面没打开），来源那一行写原因，不弹卡。
// 电脑不在线就没人来问，也就不读；登录状态只在电脑上，不进服务器。

import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_IMAGE_RATIO_MAX, FEED_IMAGE_RATIO_MIN, FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_XHS_PATH = `${API_PREFIX}/nodes/feed/xhs`;

/** 一次最多交多少条：首页和收藏各往下翻几屏，加起来。 */
export const XHS_NOTES_MAX = 200;
/** 笔记标题最多多少字（小红书标题限 20 字，留宽一些）。 */
export const XHS_TITLE_MAX_CHARS = 200;
/** 小红书上读的两处：首页「推荐」、自己的「收藏」。 */
export const XHS_PLACES = ['recommend', 'saved'] as const;
export type XhsPlace = (typeof XHS_PLACES)[number];
/** 笔记和用户的标识：24 位十六进制。 */
export const XHS_ID_PATTERN = '^[0-9a-f]{24}$';

const HttpsSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });

export const XhsNoteSchema = Type.Object({
  /** 笔记的标识。网页版链接里的 xsec_token 不交：存下的链接按 10-28 的清洗规则不带像令牌的参数（daily/urls.ts）。 */
  id: Type.String({ pattern: XHS_ID_PATTERN }),
  title: Type.String({ maxLength: XHS_TITLE_MAX_CHARS }),
  author: Type.String({ minLength: 1, maxLength: 100 }),
  avatar: OrNull(HttpsSchema),
  /** 封面。 */
  image: OrNull(HttpsSchema),
  /** 封面的高 / 宽；量不到就是 null。 */
  imageRatio: OrNull(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX })),
  video: Type.Boolean(),
  /** 在哪几处看到的。 */
  places: Type.Array(Type.Enum(XHS_PLACES), { minItems: 1, maxItems: XHS_PLACES.length }),
}, { additionalProperties: false });
export type XhsNote = Static<typeof XhsNoteSchema>;

export const XHS_READ_ERRORS = ['signed_out', 'verify', 'layout_changed', 'load_failed'] as const;

export const XhsReportSchema = Type.Object({
  requestId: RequestIdSchema,
  notes: Type.Array(XhsNoteSchema, { maxItems: XHS_NOTES_MAX }),
  error: OrNull(Type.Object({
    code: Type.Enum(XHS_READ_ERRORS),
    /** 补一句具体原因（载入失败的系统说法），不带网址。 */
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
