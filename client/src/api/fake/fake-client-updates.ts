import type { ClientUpdatesApi } from '../client.ts';
import { clientVersionOf, type ClientManifest, type ClientVersion } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeEventBus } from './event-bus.ts';
export class FakeClientUpdates implements ClientUpdatesApi {
  private readonly session: FakeSession;
  private readonly bus: FakeEventBus;
  private current: ClientManifest | null = null;
  constructor(session: FakeSession, bus: FakeEventBus) {
    this.session = session;
    this.bus = bus;
  }
  async list(): Promise<ClientVersion> {
    this.session.require();
    return clientVersionOf({ current: structuredClone(this.current), error: null });
  }
  /** 测试里装作发了一版：之后查到的就是这一版，并告诉界面版本变了。 */
  publish(buildId: string): void {
    this.current = {
      buildId,
      builtAt: '2026-10-28T00:00:00Z',
      protocol: { min: 2, max: 2 },
      summary: '网页更新，可在保存后刷新',
      assets: [{ path: 'index.html', bytes: 1, sha256: 'a'.repeat(64) }],
    };
    this.bus.emit({ type: 'client.versionChanged' });
  }
}
