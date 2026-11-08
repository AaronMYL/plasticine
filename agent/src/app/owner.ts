// 主人是谁（2026-11-08《首次使用流程》：一份 Plasticine 只有一个主人）：要不要先建账号、名字和 @账号从哪读、
// 登记一台设备并发会话。名字以网络身份为准（加入了网络，朋友看到的就是那个）；没加入时存在主人账号里。

import type { AccountState } from '../../shared/api/account.ts';
import type { SessionView } from '../../shared/api/session.ts';
import type { Device } from '../../shared/state.ts';
import { MAX_PAGE_SIZE, type StateService } from '../state/index.ts';
import { openSession } from './auth.ts';
import { browserIdentities } from './browser-identity.ts';
import type { AppDeps, Reply } from './context.ts';
import { deviceView } from './views.ts';

/** 他登记过的设备（撤销了的也算）：不算服务端替内部浏览器登记的那几台。 */
export function ownerDevices(state: StateService): Device[] {
  const internal = new Set(browserIdentities(state).map((identity) => identity.deviceId));
  return state.devices.list({ limit: MAX_PAGE_SIZE }).filter((device) => !internal.has(device.id));
}

/** 还没有主人：没设过密码，也没有登记过任何设备（有设备没密码的是老实例，算已经有主人）。 */
export function setupNeeded(state: StateService): boolean {
  return state.ownerAccount.credentials() === null && ownerDevices(state).length === 0;
}

export function ownerName(state: StateService): string | null {
  return state.networkIdentity.get()?.displayName ?? state.ownerAccount.get()?.displayName ?? null;
}

export function accountState(deps: Pick<AppDeps, 'state' | 'network'>): AccountState {
  const { state } = deps;
  const identity = state.networkIdentity.get();
  return {
    setup: setupNeeded(state) ? 'needed' : 'done',
    handle: identity?.handle ?? null,
    displayName: ownerName(state),
    passwordSet: state.ownerAccount.credentials() !== null,
    networkUrl: identity === undefined ? null : `https://${deps.network.publicHost(identity.handle)}`,
  };
}

export function sessionView(device: Device, session: { createdAt: string; expiresAt: string }): SessionView {
  return {
    device: deviceView(device, device.id),
    session: { createdAt: session.createdAt, expiresAt: session.expiresAt },
  };
}

export interface DeviceLogin {
  device: Device;
  view: SessionView;
  cookie: string;
}

/** 登记一台新设备（或者给已有的那台）开会话；在调用方的事务里跑。 */
export function loginDevice(deps: Pick<AppDeps, 'state'>, input: { name: string; local: boolean;
  existing?: Device }, now: Date): DeviceLogin {
  const at = now.toISOString();
  const device = input.existing === undefined
    ? deps.state.devices.create({ name: input.name, firstSeenAt: at, lastSeenAt: at, local: input.local })
    : deps.state.devices.touch(input.existing.id, at);
  const opened = openSession(deps, device, now);
  return { device, view: sessionView(device, opened.session), cookie: opened.cookie };
}

export function loginReply(login: DeviceLogin, body: unknown = login.view): Reply {
  return { status: 201, body, headers: { 'set-cookie': login.cookie } };
}
