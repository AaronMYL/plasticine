import { COMPUTER_FETCH_BODY_MAX_BYTES, ComputerFetchReportSchema, FEED_COMPUTER_FETCH_PATH,
  type ComputerFetchJobsResponse, type ComputerFetchReportResponse } from '../../shared/api/index.ts';
import type { Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { requireNode } from './node-protocol.ts';
import { checkInput } from './validate.ts';

export { FEED_COMPUTER_FETCH_PATH };

/** GET /v2/nodes/feed/fetch → { jobs } */
export function leaseComputerFetches(context: RequestContext): Reply {
  requireNode(context);
  const body: ComputerFetchJobsResponse = { jobs: context.deps.daily.computerFetches.lease() };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

export async function reportComputerFetch(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const report = checkInput(ComputerFetchReportSchema,
    await readJsonBody(context.req, COMPUTER_FETCH_BODY_MAX_BYTES), '电脑取回的网页');
  requireNode(context);
  context.deps.daily.subscriptions.fetchedByComputer(report);
  const body: ComputerFetchReportResponse = { ok: true };
  return { status: 200, body };
}
