import type { ClientUpdatesApi } from '../client.ts';
import type { ClientUpdatesResponse, ClientUpdate, ClientUpdateDecision, ClientManifest } from '../shared.ts';
import { ApiError } from '../errors.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeEventBus } from './event-bus.ts';
export class FakeClientUpdates implements ClientUpdatesApi {
  private readonly session: FakeSession;
  private readonly bus: FakeEventBus;
  private value: ClientUpdatesResponse = { current: null, updates: [], history: [], channelReady: false, error: null };
  constructor(session: FakeSession, bus: FakeEventBus) {
    this.session = session;
    this.bus = bus;
  }
  async list(): Promise<ClientUpdatesResponse> {
    this.session.require();
    return structuredClone(this.value);
  }
  async decide(_id: string, _input: ClientUpdateDecision): Promise<ClientUpdate> {
    this.session.require();
    throw new ApiError({ kind: 'failed', code: 'invalid_input', message: '自迭代执行通道尚未接通。', status: 409 });
  }
  publish(buildId: string, kind: 'publish' | 'rollback' = 'publish'): void {
    const manifest: ClientManifest = {
      buildId,
      builtAt: '2026-10-28T00:00:00Z',
      protocol: { min: 2, max: 2 },
      summary: '网页更新，可在保存后刷新',
      assets: [{ path: 'index.html', bytes: 1, sha256: 'a'.repeat(64) }],
    };
    const previousBuildId = this.value.current?.buildId ?? null;
    this.value = {
      current: manifest,
      updates: [{ manifest, status: 'published', selfChangeId: null, taskId: null }],
      history: [
        {
          id: `publication-${this.value.history.length}`,
          buildId,
          previousBuildId,
          kind,
          manifestDigest: 'b'.repeat(64),
          publishedAt: '2026-10-28T00:00:00Z',
        },
        ...this.value.history,
      ],
      channelReady: false,
      error: null,
    };
    this.bus.emit({ type: 'client.versionChanged' });
  }
}
