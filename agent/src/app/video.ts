// /v2/video/douyin：抖音收藏的勾选清单（信息流的来源管理里打开，《优化清单》第 9 条）——列表（按收藏夹、标题和作者搜）、
// 同步（排给 Mac）、处理选中的。/v2/nodes/douyin：Mac 来取活、交回结果（节点 Bearer，shared/api/video.ts）。
// /v2/video/transcriber：本地转写装没装、在后台装（第13批）。
// 写操作按 requestId 幂等；事件在提交之后推（video_changed）。

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

/** 一页列多少条（设计稿一屏六七条，往下翻再读）。 */
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

/** GET /v2/nodes/douyin → { jobs }：Mac 在线时来取活（取走的标成在做，十分钟没交回再给）。 */
export function douyinJobs(context: RequestContext): Reply {
  requireNode(context);
  const body: DouyinJobsResponse = { jobs: context.deps.video.douyin.jobs() };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

/** POST /v2/nodes/douyin：交回一件活。同一份再交一次不会出两条（作品按 ID 去重，了结过的活不再动）。 */
export async function reportDouyin(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(DouyinReportSchema, await readJsonBody(context.req), '抖音结果');
  requireNode(context);
  const body: DouyinReportResponse = context.deps.video.douyin.report(report);
  return { status: 200, body };
}

/** GET /v2/video/transcriber → { status }：本地转写装没装、装到哪了（第13批）。 */
export function getTranscriber(context: RequestContext): Reply {
  requireAuth(context);
  const body: TranscriberResponse = { status: context.deps.video.kit.status() };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

/** POST /v2/video/transcriber/install → 202 { status }：在后台下载装好（装着、装好的不重来）。 */
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
