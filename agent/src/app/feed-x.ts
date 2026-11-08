// X 上他关注的人（第 3 批，shared/api/feed-x.ts）：Mac 在线时来问到没到读的时候，读完把帖子交来入库。凭节点 Bearer，
// 不是会话；Mac 不在线就没人来问，也就不读。没读到（没登录、X 改版）只记原因，设置里那一行写出来，不弹卡。

import { FEED_X_PATH, XTimelineReportSchema, type XTimelineDue, type XTimelineReportResponse } from
  '../../shared/api/index.ts';
import type { Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { requireNode } from './node-protocol.ts';
import { checkInput } from './validate.ts';

export { FEED_X_PATH };

/** GET /v2/nodes/feed/x → { due, everyMinutes } */
export function getXTimelineDue(context: RequestContext): Reply {
  requireNode(context);
  const body: XTimelineDue = context.deps.daily.subscriptions.xDue();
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

/**
 * POST /v2/nodes/feed/x：同一批帖子再交一次（回执丢了重发）不会出两条——条目按帖子标识去重，所以这里不另记请求回执。
 */
export async function reportXTimeline(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(XTimelineReportSchema, await readJsonBody(context.req), 'X 时间线');
  // 读正文期间节点被撤销了：不收。
  requireNode(context);
  const body: XTimelineReportResponse = { added: context.deps.daily.subscriptions.ingestX(report) };
  return { status: 200, body };
}
