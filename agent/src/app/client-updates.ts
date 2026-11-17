import { requireAuth, type RequestContext, type Reply } from './context.ts';

/** GET /v2/client-version：只回界面要比的版本号那几样（11-12：整份清单约 870 KB，不再每次都传）。 */
export function clientVersion(context: RequestContext): Reply {
  requireAuth(context);
  context.deps.clientUpdates.scan();
  return { status: 200, body: context.deps.clientUpdates.version() };
}
