// /v2/devices: the registered devices, and revoking one (its sessions end with it; the rows stay). 2026-11-08: the
// browser pairing invitations (/v2/devices/pairing-codes*) are gone; devices log in with the password instead.

import type { DeviceListResponse, RevokeDeviceResponse } from '../../shared/api/index.ts';
import { MAX_PAGE_SIZE } from '../state/index.ts';
import { notFoundError } from './api-error.ts';
import { SESSION_COOKIE } from './config.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { clearedCookie } from './http.ts';
import { deviceView } from './views.ts';

/** GET /v2/devices */
export function listDevices(context: RequestContext): Reply {
  const auth = requireAuth(context);
  const devices = context.deps.state.devices.list({ limit: MAX_PAGE_SIZE });
  const body: DeviceListResponse = { devices: devices.map((device) => deviceView(device, auth.device.id)) };
  return { status: 200, body };
}

/** DELETE /v2/devices/:id — naturally idempotent: revoking a revoked device answers the same. */
export function revokeDevice(context: RequestContext): Reply {
  const auth = requireUserAuth(context);
  const { state } = context.deps;
  const id = param(context, 'id');
  if (state.devices.get(id) === undefined) {
    throw notFoundError('这台设备');
  }
  const at = context.deps.now().toISOString();
  const device = state.transaction(() => {
    state.sessions.revokeForDevice(id, at);
    // Its signing key goes with it (M3): it can sign nothing, and the same browser may pair again with it.
    state.deviceKeys.revokeForDevice(id, at);
    return state.devices.revoke(id, at);
  });
  // Its open streams stop now, not at their next heartbeat.
  context.deps.hub.closeDevice(id);
  const body: RevokeDeviceResponse = { device: deviceView(device, auth.device.id) };
  const self = id === auth.device.id;
  return { status: 200, body, ...(self ? { headers: { 'set-cookie': clearedCookie(SESSION_COOKIE) } } : {}) };
}
