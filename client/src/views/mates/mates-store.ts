import type { PlasticineApi } from '../../api/client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type { MateListResponse, ListLinesResponse } from '../../api/shared.ts';
import type { LoadStatus } from '../../state/load.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';
import { Store } from '../../state/store.ts';

export interface MatesData extends MateListResponse { status: LoadStatus; error: string | null }
export interface MateTasksData extends ListLinesResponse { status: LoadStatus; error: string | null }

/** 花名册属于当前登录会话，整页、侧栏、@菜单和对话框读同一份。 */
export class MatesStore {
  readonly data = new Store<MatesData>({ status: 'idle', error: null, mates: [], groups: [], legacyChats: [] });
  private readonly hub: EventsHub;
  private readonly api: PlasticineApi;
  private readonly tasks = new Map<string, { store: Store<MateTasksData>;
    loader: SnapshotLoader<ListLinesResponse> }>();
  private readonly loader: SnapshotLoader<MateListResponse>;
  private release: (() => void) | null = null;
  constructor(api: PlasticineApi, hub: EventsHub) {
    this.hub = hub;
    this.api = api;
    this.loader = new SnapshotLoader({ fetch: () => api.mates.list(),
      apply: (list) => this.data.set({ ...list, status: 'ready', error: null }),
      fail: (error) => this.data.set((current) => ({ ...current, status: 'failed', error })),
    });
  }
  start(): void {
    if (this.release !== null) return;
    this.loader.restart();
    for (const entry of this.tasks.values()) {
      entry.loader.restart();
      void entry.loader.load();
    }
    this.data.set((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading' }));
    this.release = this.hub.on((event) => {
      this.loader.note(event);
      for (const [id, entry] of this.tasks) {
        entry.loader.note(event);
        if (event.type === 'resync' || (event.type === 'line' && event.event.type === 'line_changed'
          && event.event.line.mateGroupId === id)) entry.loader.schedule();
      }
      if (event.type === 'resync' || (event.type === 'line' && event.event.type === 'line_changed'
        && (event.event.line.kind === 'side' || event.event.line.mateId != null
          || event.event.line.mateGroupId != null))) this.loader.schedule();
    });
    void this.loader.load();
  }
  stop(): void {
    this.release?.(); this.release = null; this.loader.stop();
    for (const entry of this.tasks.values()) entry.loader.stop();
  }
  reload(): Promise<void> { return this.loader.load(); }
  taskList(groupId: string): Store<MateTasksData> {
    const previous = this.tasks.get(groupId);
    if (previous !== undefined) return previous.store;
    const store = new Store<MateTasksData>({ lines: [], status: 'loading', error: null });
    const loader = new SnapshotLoader<ListLinesResponse>({ fetch: () => this.api.mateGroups.listTasks(groupId),
      apply: (data) => store.set({ ...data, status: 'ready', error: null }),
      fail: (error) => store.set((data) => ({ ...data, status: 'failed', error })),
    });
    this.tasks.set(groupId, { store, loader });
    void loader.load();
    return store;
  }
  reloadTasks(groupId: string): Promise<void> {
    this.taskList(groupId);
    return this.tasks.get(groupId)!.loader.load();
  }
}
