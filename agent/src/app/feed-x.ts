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

export async function reportXTimeline(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(XTimelineReportSchema, await readJsonBody(context.req), 'X 时间线');
  requireNode(context);
  const body: XTimelineReportResponse = { added: context.deps.daily.subscriptions.ingestX(report) };
  return { status: 200, body };
}
