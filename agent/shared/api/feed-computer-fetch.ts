// 服务器取不到的网址交给在线的电脑取（第13批，11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」）：服务器
// 自己取博客、Reddit，连不上、被拒、被限流时，有电脑客户端在线就排一件「替服务器取这个网址」的活：
//   GET  /v2/nodes/feed/fetch（节点 Bearer）→ { jobs: [{ id, url }] }：要电脑替服务器取的网址（没有就空）；电脑每半分钟
//        来领一次，服务器也靠这个知道有电脑在线；
//   POST /v2/nodes/feed/fetch（节点 Bearer）{ requestId, jobId, page, error } → { ok }：取到的正文（跳转后的地址 + 文字）
//        或没取到的原因。电脑只取、不解析；解析、入库在服务端，和服务器自己取到的一样。

import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_COMPUTER_FETCH_PATH = `${API_PREFIX}/nodes/feed/fetch`;

/** 一次最多领几件。 */
export const COMPUTER_FETCH_JOBS_MAX = 5;
/** 正文最多多少字（和服务器自己取时的 2 MB 上限一致）。 */
export const COMPUTER_FETCH_TEXT_MAX_CHARS = 2 * 1024 * 1024;
/** 交回正文的请求体上限（正文 + 外面一层）。 */
export const COMPUTER_FETCH_BODY_MAX_BYTES = 9 * 1024 * 1024;

const HttpsSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });
const JobIdSchema = Type.String({ pattern: '^ff-[A-Za-z0-9-]{8,64}$' });

export const ComputerFetchJobSchema = Type.Object({
  id: JobIdSchema,
  url: HttpsSchema,
}, { additionalProperties: false });
export type ComputerFetchJob = Static<typeof ComputerFetchJobSchema>;

export const ComputerFetchJobsResponseSchema = Type.Object({
  jobs: Type.Array(ComputerFetchJobSchema, { maxItems: COMPUTER_FETCH_JOBS_MAX }),
}, { additionalProperties: false });
export type ComputerFetchJobsResponse = Static<typeof ComputerFetchJobsResponseSchema>;

export const COMPUTER_FETCH_ERRORS = ['load_failed', 'http_error', 'too_large', 'refused'] as const;

export const ComputerFetchReportSchema = Type.Object({
  requestId: RequestIdSchema,
  jobId: JobIdSchema,
  /** 取到的：跳转以后的地址和正文。 */
  page: OrNull(Type.Object({
    url: HttpsSchema,
    text: Type.String({ maxLength: COMPUTER_FETCH_TEXT_MAX_CHARS }),
  }, { additionalProperties: false })),
  error: OrNull(Type.Object({
    code: Type.Enum(COMPUTER_FETCH_ERRORS),
    /** 对方回的状态码（http_error 时）。 */
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    /** 补一句具体原因（载入失败的系统说法），不带网址。 */
    detail: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type ComputerFetchReport = Static<typeof ComputerFetchReportSchema>;

export const ComputerFetchReportResponseSchema = Type.Object({ ok: Type.Literal(true) });
export type ComputerFetchReportResponse = Static<typeof ComputerFetchReportResponseSchema>;
