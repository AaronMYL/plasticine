import type { Device, DeviceNode } from '../../shared/state.ts';
import type { InternalBrowserCookie } from '../cloud-tools/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { openSession, type OpenedSession } from './auth.ts';
import { BROWSER_IDENTITIES_KEY, browserIdentities, browserIdentityLive } from './browser-identity.ts';
import { SESSION_COOKIE } from './config.ts';

interface BrowserSession extends OpenedSession { device: Device }

export class BrowserSessions {
  readonly #state: StateService;
  readonly #now: () => Date;
  readonly #opened = new Map<string, BrowserSession>();

  constructor(state: StateService, now: () => Date) {
    this.#state = state;
    this.#now = now;
  }

  open(node: DeviceNode | null = null): BrowserSession {
    const state = this.#state;
    const now = this.#now();
    const source = node === null ? 'cloud' : `node:${node.id}`;
    return state.transaction(() => {
      const identities = browserIdentities(state);
      let identity = identities.find((item) => item.source === source);
      let device = identity === undefined ? undefined : state.devices.get(identity.deviceId);
      if (identity !== undefined && (device === undefined || device.revokedAt !== null)) {
        throw new ApiError(403, 'browser_session_revoked', '这个内部浏览器的设备已撤销。');
      }
      if (device === undefined) {
        device = state.devices.create({ name: node === null ? 'Plasticine 云端浏览器' : `Plasticine · ${node.name}`,
          firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString() });
        identity = { source, deviceId: device.id, nodeId: node?.id ?? null,
          credentialHash: node?.credentialHash ?? null };
        identities.push(identity);
        state.kernelSettings.set(BROWSER_IDENTITIES_KEY, identities);
      }
      if (identity === undefined) throw new Error('内部浏览器没有身份记录');
      if (node !== null && identity.credentialHash !== node.credentialHash) {
        identity.credentialHash = node.credentialHash;
        state.kernelSettings.set(BROWSER_IDENTITIES_KEY, identities);
        this.#opened.delete(source);
      }
      if (!browserIdentityLive(state, identity)) {
        throw new ApiError(403, 'browser_session_revoked', '这个内部浏览器所属的节点已撤销。');
      }
      const cached = this.#opened.get(source);
      const session = cached === undefined ? undefined : state.sessions.get(cached.session.id);
      if (cached !== undefined && session !== undefined && session.revokedAt === null
        && Date.parse(session.expiresAt) > now.getTime()) return cached;
      state.sessions.revokeForDevice(device.id, now.toISOString());
      const opened = { device, ...openSession({ state }, device, now) };
      this.#opened.set(source, opened);
      return opened;
    });
  }

  cookies(publicUrl: string): InternalBrowserCookie[] {
    const url = new URL(publicUrl);
    const scope = { name: SESSION_COOKIE, url: url.origin + '/', path: '/', httpOnly: true,
      secure: url.protocol === 'https:', sameSite: 'Strict' as const };
    let opened: BrowserSession;
    try { opened = this.open(); } catch (error) {
      if (error instanceof ApiError && error.code === 'browser_session_revoked') {
        return [{ ...scope, value: '', expires: 0 }];
      }
      throw error;
    }
    return [{ ...scope, value: opened.cookie.slice(SESSION_COOKIE.length + 1).split(';')[0]!,
      expires: Date.parse(opened.session.expiresAt) / 1000 }];
  }
}
