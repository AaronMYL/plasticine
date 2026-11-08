// Who is asking: the session cookie → its hash → a live session of a device that is not revoked. Anything else is
// "no session" and the router answers 401. "Last seen" is written at most once a minute per session.

import type { IncomingMessage } from 'node:http';
import type { Device, Session } from '../../shared/state.ts';
import { LAST_SEEN_WRITE_INTERVAL_MS, SESSION_COOKIE, SESSION_TTL_MS } from './config.ts';
import type { AppDeps, AuthContext } from './context.ts';
import { parseCookies, sessionCookie } from './http.ts';
import { hashSecret, newSessionToken } from './secrets.ts';
import { browserIdentity, browserIdentityLive } from './browser-identity.ts';

function staleSince(lastSeenAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastSeenAt) >= LAST_SEEN_WRITE_INTERVAL_MS;
}

export function authenticate(deps: Pick<AppDeps, 'state' | 'now'>, req: IncomingMessage): AuthContext | null {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  if (token === undefined || token === '') {
    return null;
  }
  const { state } = deps;
  const session = state.sessions.findByTokenHash(hashSecret(token));
  const now = deps.now();
  if (session === undefined || session.revokedAt !== null || Date.parse(session.expiresAt) <= now.getTime()) {
    return null;
  }
  const device = state.devices.get(session.deviceId);
  if (device === undefined || device.revokedAt !== null) {
    return null;
  }
  const identity = browserIdentity(state, device.id);
  if (identity !== undefined && !browserIdentityLive(state, identity)) return null;
  const actor = identity === undefined ? 'user' as const : 'system' as const;
  if (!staleSince(session.lastSeenAt, now)) {
    return { session, device, actor };
  }
  const at = now.toISOString();
  return state.transaction(() => ({
    session: state.sessions.touch(session.id, at),
    device: state.devices.touch(device.id, at),
    actor,
  }));
}

/**
 * Whether a session that authenticated earlier still holds now: not logged out, not expired, its device not revoked.
 * A long-lived stream asks this again from time to time, since it authenticated only when it opened.
 */
export function stillAuthenticated(deps: Pick<AppDeps, 'state' | 'now'>, auth: AuthContext): boolean {
  const session = deps.state.sessions.findByTokenHash(auth.session.tokenHash);
  if (session === undefined || session.revokedAt !== null) {
    return false;
  }
  if (Date.parse(session.expiresAt) <= deps.now().getTime()) {
    return false;
  }
  const device = deps.state.devices.get(session.deviceId);
  const identity = browserIdentity(deps.state, session.deviceId);
  return device !== undefined && device.revokedAt === null
    && (identity === undefined || browserIdentityLive(deps.state, identity));
}

export interface OpenedSession {
  session: Session;
  /** The Set-Cookie header value; the only place the plain token ever appears. */
  cookie: string;
}

/** A new session for `device`; call inside the transaction that registered the device. */
export function openSession(deps: Pick<AppDeps, 'state'>, device: Device, at: Date): OpenedSession {
  const token = newSessionToken();
  const session = deps.state.sessions.create({
    tokenHash: hashSecret(token),
    deviceId: device.id,
    expiresAt: new Date(at.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: at.toISOString(),
  });
  return { session, cookie: sessionCookie(SESSION_COOKIE, token, SESSION_TTL_MS) };
}
