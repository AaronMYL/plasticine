import { requireAuth, type RequestContext, type Reply } from './context.ts';

export function clientVersion(context: RequestContext): Reply {
  requireAuth(context);
  context.deps.clientUpdates.scan();
  return { status: 200, body: context.deps.clientUpdates.version() };
}
