import type { LogoutResponse } from '../../shared/api/index.ts';
import { SESSION_COOKIE } from './config.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { clearedCookie } from './http.ts';
import { sessionView } from './owner.ts';

/** GET /v2/session */
export function currentSession(context: RequestContext): Reply {
  const auth = requireAuth(context);
  return { status: 200, body: { ...sessionView(auth.device, auth.session),
    ...(auth.actor === 'system' ? { actor: 'system' } : {}) } };
}

/** DELETE /v2/session: ends this session only; the device stays registered and can log in again. */
export function logout(context: RequestContext): Reply {
  const auth = requireAuth(context);
  context.deps.state.sessions.revoke(auth.session.id, context.deps.now().toISOString());
  context.deps.hub.closeSession(auth.session.id);
  const body: LogoutResponse = { loggedOut: true };
  return { status: 200, body, headers: { 'set-cookie': clearedCookie(SESSION_COOKIE) } };
}
