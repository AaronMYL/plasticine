import {
  DouyinListQuerySchema,
  DouyinProcessRequestSchema,
  DouyinReportSchema,
  DouyinSyncRequestSchema,
  TranscriberInstallRequestSchema,
  type DouyinJobsResponse,
  type DouyinListResponse,
  type DouyinProcessResponse,
  type DouyinReportResponse,
  type DouyinSyncResponse,
  type TranscriberResponse,
} from '../../shared/api/index.ts';
import { videoWorkView } from '../video/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { requireNode } from './node-protocol.ts';
import { checkInput, queryObject } from './validate.ts';

const DOUYIN_PAGE_DEFAULT = 50;

/** GET /v2/video/douyin?folder=&q=&phase=&limit=&offset= */
export function listDouyin(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(DouyinListQuerySchema,
    queryObject(context.url.searchParams, { limit: 'integer', offset: 'integer' }), '查询参数');
  const filter = { ...(query.folder === undefined ? {} : { folder: query.folder }),
    ...(query.q === undefined || query.q.trim() === '' ? {} : { q: query.q }),
    ...(query.phase === undefined ? {} : { phase: query.phase }) };
  const body: DouyinListResponse = context.deps.video.douyin.list(filter, query.limit ?? DOUYIN_PAGE_DEFAULT,
    query.offset ?? 0);
  return { status: 200, body };
}

/** POST /v2/video/douyin/sync → 202 { sync } */
export async function syncDouyin(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(DouyinSyncRequestSchema, raw.value, '同步抖音收藏');
  return idempotent(context, body.requestId, (afterCommit) => {
    const reply: DouyinSyncResponse = { sync: context.deps.video.douyin.sync(body.full) };
    afterCommit(() => context.deps.hub.publish({ type: 'video_changed' }));
    return { status: 202, body: reply };
  }, { bodyDigest: raw.digest });
}

/** POST /v2/video/douyin/process → 202 { works, queued } */
export async function processDouyin(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(DouyinProcessRequestSchema, raw.value, '处理抖音收藏');
  if ((body.ids === undefined || body.ids.length === 0) && body.folder === undefined) {
    throw new ApiError(400, 'invalid_request', '先勾选要处理的收藏，或选一个收藏夹。');
  }
  return idempotent(context, body.requestId, () => {
    const result = context.deps.video.douyin.process({ ...(body.ids === undefined ? {} : { ids: body.ids }),
      ...(body.folder === undefined ? {} : { folder: body.folder }) });
    const reply: DouyinProcessResponse = { works: result.works.map(videoWorkView), queued: result.queued };
    return { status: 202, body: reply };
  }, { bodyDigest: raw.digest });
}

export function douyinJobs(context: RequestContext): Reply {
  requireNode(context);
  const body: DouyinJobsResponse = { jobs: context.deps.video.douyin.jobs() };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

export async function reportDouyin(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(DouyinReportSchema, await readJsonBody(context.req), '抖音结果');
  requireNode(context);
  const body: DouyinReportResponse = context.deps.video.douyin.report(report);
  return { status: 200, body };
}

export function getTranscriber(context: RequestContext): Reply {
  requireAuth(context);
  const body: TranscriberResponse = { status: context.deps.video.kit.status() };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

export async function installTranscriber(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(TranscriberInstallRequestSchema, raw.value, '安装本地转写');
  if (context.deps.video.kit.status().state === 'unsupported') {
    throw new ApiError(409, 'unsupported', '这种系统没有现成的本地转写组件，要在服务器上自己配。');
  }
  return idempotent(context, body.requestId, () => {
    const reply: TranscriberResponse = { status: context.deps.video.kit.install() };
    return { status: 202, body: reply };
  }, { bodyDigest: raw.digest });
}
