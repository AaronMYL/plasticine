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

export async function reportXhs(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(XhsReportSchema, await readJsonBody(context.req), '小红书');
  requireNode(context);
  const body: XhsReportResponse = { added: context.deps.daily.subscriptions.ingestXhs(report) };
  return { status: 200, body };
}
