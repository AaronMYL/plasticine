// 小红书（第13批，shared/api/feed-xhs.ts）：电脑客户端在线时来问到没到读的时候，读完把笔记交来入库。凭节点 Bearer，
// 不是会话；电脑不在线就没人来问，也就不读。没读到（没登录、要验证、改版）只记原因，来源那一行写出来，不弹卡。

import { FEED_XHS_PATH, XhsReportSchema, type XhsDue, type XhsReportResponse } from '../../shared/api/index.ts';
import type { Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { requireNode } from './node-protocol.ts';
import { checkInput } from './validate.ts';

export { FEED_XHS_PATH };

/** GET /v2/nodes/feed/xhs → { due, everyMinutes } */
export function getXhsDue(context: RequestContext): Reply {
  requireNode(context);
  const body: XhsDue = context.deps.daily.subscriptions.xhsDue();
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

/** POST /v2/nodes/feed/xhs：同一批笔记再交一次（回执丢了重发）不会出两条——条目按笔记标识去重。 */
export async function reportXhs(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(XhsReportSchema, await readJsonBody(context.req), '小红书');
  // 读正文期间节点被撤销了：不收。
  requireNode(context);
  const body: XhsReportResponse = { added: context.deps.daily.subscriptions.ingestXhs(report) };
  return { status: 200, body };
}
