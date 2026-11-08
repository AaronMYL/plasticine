// /v2/session (decision 90 ②): a device exchanges a one-time pairing code for a long-lived session and is
// registered at the same time; GET shows who is logged in; DELETE logs this browser out.
// A pairing that carries a request id is recorded in api_requests (约定 1), so a retry after a lost answer finds the
// device it registered instead of failing on the code it already used.

import {
  PAIRING_REPLAY_WINDOW_MS,
  PairDeviceRequestSchema,
  REPLAYED_HEADER,
  SESSION_PATH,
  type LogoutResponse,
  type SessionView,
} from '../../shared/api/index.ts';
import type { ApiRequestRecord, Device, PairingCode, Session } from '../../shared/state.ts';
import { ApiError } from './api-error.ts';
import { openSession } from './auth.ts';
import { SESSION_COOKIE } from './config.ts';
import { requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { clearedCookie, readJsonBody } from './http.ts';
import { pairingCodeHash } from './pairing-code.ts';
import { checkInput } from './validate.ts';
import { deviceView } from './views.ts';

const NEW_CODE_NEXT = '在已登录的设备上打开「设置 → 系统 → 设备」，重新生成邀请。';
// The same scope idempotency.ts gives this route, so one request id cannot stand for two different operations.
const PAIRING_SCOPE = `POST ${SESSION_PATH}`;

function sessionView(device: Device, session: Session): SessionView {
  return {
    device: deviceView(device, device.id),
    session: { createdAt: session.createdAt, expiresAt: session.expiresAt },
  };
}

function tooManyAttempts(retryAfterMs: number): ApiError {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return new ApiError(429, 'too_many_attempts', '配对码输错的次数太多，配对先停一会儿。', {
    next: `${minutes} 分钟后再试；${NEW_CODE_NEXT}`,
  });
}

function requestIdReused(): ApiError {
  return new ApiError(409, 'request_id_reused', '这个 request_id 已经用在另一个操作上了。', {
    field: 'requestId',
    next: '每次新的配对生成一个新的 request_id；同一次配对重试才用原来的。',
  });
}

/** The live record of an earlier pairing with this request id; a live record of another operation is a misuse. */
function earlierPairing(deps: AppDeps, requestId: string | undefined, now: Date): ApiRequestRecord | undefined {
  if (requestId === undefined) {
    return undefined;
  }
  const stored = deps.state.apiRequests.find(requestId);
  if (stored === undefined || Date.parse(stored.expiresAt) <= now.getTime()) {
    return undefined;
  }
  if (stored.scope !== PAIRING_SCOPE) {
    throw requestIdReused();
  }
  return stored;
}

/**
 * The same pairing again (its answer was lost): a new session for the device it registered. The first session's
 * token exists only as a hash, so it cannot be sent back; that session simply stays unused.
 */
function replayPairing(deps: AppDeps, earlier: ApiRequestRecord, code: PairingCode, now: Date): Reply {
  if (code.deviceId === null || code.deviceId !== earlier.deviceId) {
    throw requestIdReused();
  }
  const device = deps.state.devices.get(code.deviceId);
  if (device === undefined || device.revokedAt !== null) {
    throw new ApiError(401, 'pairing_code_used', '这个配对码登记的设备已经撤销了，不能再用它登录。', {
      field: 'code',
      next: NEW_CODE_NEXT,
    });
  }
  const opened = deps.state.transaction(() => openSession(deps, device, now));
  return {
    status: 201,
    body: sessionView(device, opened.session),
    headers: { 'set-cookie': opened.cookie, [REPLAYED_HEADER]: '1' },
  };
}

/** POST /v2/session */
export async function pairDevice(context: RequestContext): Promise<Reply> {
  const { deps } = context;
  const { state, pairingLimiter } = deps;
  const body = checkInput(PairDeviceRequestSchema, await readJsonBody(context.req), '配对请求');
  if (pairingLimiter.blocked()) {
    throw tooManyAttempts(pairingLimiter.retryAfterMs());
  }
  const now = deps.now();
  const code = state.pairingCodes.findByHash(pairingCodeHash(body.code));
  if (code === undefined) {
    pairingLimiter.recordFailure();
    throw new ApiError(401, 'pairing_code_invalid', '配对码不对。', {
      field: 'code',
      next: '核对后再输入，或在原设备重新生成配对邀请。',
    });
  }
  const earlier = earlierPairing(deps, body.requestId, now);
  if (earlier !== undefined) {
    return replayPairing(deps, earlier, code, now);
  }
  if (code.usedAt !== null) {
    pairingLimiter.recordFailure();
    throw new ApiError(401, 'pairing_code_used', '这个配对码已经用过了，一个码只能用一次。', {
      field: 'code',
      next: NEW_CODE_NEXT,
    });
  }
  if (Date.parse(code.expiresAt) <= now.getTime()) {
    throw new ApiError(401, 'pairing_code_expired', '这个配对码已经过期了（10 分钟内有效）。', {
      field: 'code',
      next: NEW_CODE_NEXT,
    });
  }
  const at = now.toISOString();
  const opened = state.transaction(() => {
    const device = state.devices.create({ name: body.deviceName, firstSeenAt: at, lastSeenAt: at });
    state.pairingCodes.markUsed(code.id, { usedAt: at, deviceId: device.id });
    if (body.requestId !== undefined) {
      // Only which device this pairing registered is kept: a replay opens a fresh session, never reads a token.
      state.apiRequests.save({
        requestId: body.requestId,
        scope: PAIRING_SCOPE,
        deviceId: device.id,
        status: 201,
        body: { deviceId: device.id },
        createdAt: at,
        expiresAt: new Date(now.getTime() + PAIRING_REPLAY_WINDOW_MS).toISOString(),
      });
    }
    return { device, ...openSession(deps, device, now) };
  });
  return {
    status: 201,
    body: sessionView(opened.device, opened.session),
    headers: { 'set-cookie': opened.cookie },
  };
}

/** GET /v2/session */
export function currentSession(context: RequestContext): Reply {
  const auth = requireAuth(context);
  return { status: 200, body: { ...sessionView(auth.device, auth.session),
    ...(auth.actor === 'system' ? { actor: 'system' } : {}) } };
}

/** DELETE /v2/session: ends this session only; the device stays registered and can pair again. */
export function logout(context: RequestContext): Reply {
  const auth = requireAuth(context);
  context.deps.state.sessions.revoke(auth.session.id, context.deps.now().toISOString());
  // Streams this session opened would otherwise keep receiving messages after the logout.
  context.deps.hub.closeSession(auth.session.id);
  const body: LogoutResponse = { loggedOut: true };
  return { status: 200, body, headers: { 'set-cookie': clearedCookie(SESSION_COOKIE) } };
}
