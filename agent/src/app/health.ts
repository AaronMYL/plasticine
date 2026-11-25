import type { Reply, RequestContext } from './context.ts';

/** GET /v2/health */
export function health(context: RequestContext): Reply {
  return { status: 200, body: { ok: true, accepting: true, dryRun: context.deps.dryRun } };
}
