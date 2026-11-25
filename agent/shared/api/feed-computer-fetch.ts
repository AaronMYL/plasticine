import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { FEED_URL_MAX_CHARS } from '../state.ts';

export const FEED_COMPUTER_FETCH_PATH = `${API_PREFIX}/nodes/feed/fetch`;

export const COMPUTER_FETCH_JOBS_MAX = 5;
export const COMPUTER_FETCH_TEXT_MAX_CHARS = 2 * 1024 * 1024;
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
  page: OrNull(Type.Object({
    url: HttpsSchema,
    text: Type.String({ maxLength: COMPUTER_FETCH_TEXT_MAX_CHARS }),
  }, { additionalProperties: false })),
  error: OrNull(Type.Object({
    code: Type.Enum(COMPUTER_FETCH_ERRORS),
    status: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    detail: Type.Optional(Type.String({ maxLength: 300 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type ComputerFetchReport = Static<typeof ComputerFetchReportSchema>;

export const ComputerFetchReportResponseSchema = Type.Object({ ok: Type.Literal(true) });
export type ComputerFetchReportResponse = Static<typeof ComputerFetchReportResponseSchema>;
