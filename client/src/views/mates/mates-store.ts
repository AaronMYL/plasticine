import type { PlasticineApi } from '../../api/client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type { MateListResponse } from '../../api/shared.ts';
import type { LoadStatus } from '../../state/load.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';
import { Store } from '../../state/store.ts';

export interface MatesData extends MateListResponse { status: LoadStatus; error: string | null }

/** 花名册属于当前登录会话，整页、侧栏、@菜单和对话框读同一份。 */
export class MatesStore {
  readonly data = new Store<MatesData>({ status: 'idle', error: null, mates: [], groups: [], legacyChats: [] });
  private readonly hub: EventsHub;
  private readonly loader: SnapshotLoader<MateListResponse>;
  private release: (() => void) | null = null;
  constructor(api: PlasticineApi, hub: EventsHub) {
    this.hub = hub;
    this.loader = new SnapshotLoader({ fetch: () => api.mates.list(),
      apply: (list) => this.data.set({ ...list, status: 'ready', error: null }),
      fail: (error) => this.data.set((current) => ({ ...current, status: 'failed', error })),
    });
  }
  start(): void {
    if (this.release !== null) return;
    this.loader.restart();
    this.data.set((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading' }));
    this.release = this.hub.on((event) => {
      this.loader.note(event);
      if (event.type === 'resync' || (event.type === 'line' && event.event.type === 'line_changed'
        && (event.event.line.kind === 'side' || event.event.line.mateId != null
          || event.event.line.mateGroupId != null))) this.loader.schedule();
    });
    void this.loader.load();
  }
  stop(): void { this.release?.(); this.release = null; this.loader.stop(); }
  reload(): Promise<void> { return this.loader.load(); }
}
