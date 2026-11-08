// 设备 tab 的数据：执行节点列表（含默认上限、受保护路径）和最近的设备动作。打开那一页才拉；事件流来的节点和动作按版本
// 就地换，拉的期间到的事件换上快照后再放一遍——旧快照盖不掉新事件。被拒的动作（超上限、受保护路径）就是在这里看到原因的。

import type { PlasticineApi } from '../../api/client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type { LiveEvent, NodeActionView, NodeListResponse, NodeView } from '../../api/types.ts';
import { Store } from '../../state/store.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';
import { idle, needsRead, type Loaded } from './loaded.ts';

// 页面上列最近 50 个（服务端一次也只给 50 个）。
const ACTIONS_SHOWN = 50;

interface Snapshot {
  nodes: NodeListResponse;
  actions: NodeActionView[];
}

function newestFirst(a: NodeActionView, b: NodeActionView): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id);
}

export class DeviceStore {
  readonly nodes = new Store<Loaded<NodeListResponse>>(idle());
  readonly actions = new Store<Loaded<NodeActionView[]>>(idle());
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private readonly loader: SnapshotLoader<Snapshot>;
  private readonly nodeVersions = new Map<string, number>();
  private readonly actionVersions = new Map<string, number>();
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.hub = hub;
    this.loader = new SnapshotLoader({
      fetch: async () => ({ nodes: await this.api.nodes.list(), actions: await this.api.nodes.actions(null) }),
      apply: (snapshot, replay) => this.applySnapshot(snapshot, replay),
      fail: (message) => {
        this.nodes.set((data) => ({ ...data, status: 'failed', error: message }));
        this.actions.set((data) => ({ ...data, status: 'failed', error: message }));
      },
    });
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.loader.restart();
    this.stopListening = this.hub.on((event) => this.onEvent(event));
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.loader.stop();
    this.nodes.set((data) => data.status === 'loading' ? idle() : data);
    this.actions.set((data) => data.status === 'loading' ? idle() : data);
  }

  /** 设备 tab 打开时调。 */
  open(): void {
    if (needsRead(this.nodes.get()) || needsRead(this.actions.get())) {
      void this.reload();
    }
  }

  reload(): Promise<void> {
    const loading = <T>(data: Loaded<T>): Loaded<T> => ({
      ...data,
      status: data.value === null ? 'loading' : data.status,
      error: null,
    });
    this.nodes.set(loading);
    this.actions.set(loading);
    return this.loader.load();
  }

  /** 一台节点的新样子（写操作的回答、事件流、409 带来的现在那一台）。比手里旧的不换。 */
  applyNode(node: NodeView): void {
    const known = this.nodeVersions.get(node.id);
    if (known !== undefined && known >= node.version) {
      return;
    }
    this.nodeVersions.set(node.id, node.version);
    this.nodes.set((data) => {
      if (data.value === null) {
        return data;
      }
      const listed = data.value.nodes.some((candidate) => candidate.id === node.id);
      const nodes = listed
        ? data.value.nodes.map((candidate) => (candidate.id === node.id ? node : candidate))
        : [node, ...data.value.nodes];
      return { ...data, value: { ...data.value, nodes } };
    });
  }

  private applyAction(action: NodeActionView): void {
    const known = this.actionVersions.get(action.id);
    if (known !== undefined && known >= action.version) {
      return;
    }
    this.actionVersions.set(action.id, action.version);
    this.actions.set((data) => {
      if (data.value === null) {
        return data;
      }
      const rest = data.value.filter((candidate) => candidate.id !== action.id);
      return { ...data, value: [action, ...rest].sort(newestFirst).slice(0, ACTIONS_SHOWN) };
    });
  }

  private onEvent(event: LiveEvent): void {
    this.loader.note(event);
    if (event.type === 'node.changed') {
      this.applyNode(event.node);
    } else if (event.type === 'node_action.recorded') {
      this.applyAction(event.action);
    } else if (event.type === 'resync' && this.nodes.get().status !== 'idle') {
      void this.reload();
    }
  }

  /** 换上快照：版本表跟快照一致（先清空），再放一遍拉的期间到的事件，比快照新的才换。 */
  private applySnapshot(snapshot: Snapshot, replay: readonly LiveEvent[]): void {
    this.nodeVersions.clear();
    this.actionVersions.clear();
    for (const node of snapshot.nodes.nodes) {
      this.nodeVersions.set(node.id, node.version);
    }
    for (const action of snapshot.actions) {
      this.actionVersions.set(action.id, action.version);
    }
    this.nodes.set({ status: 'ready', error: null, value: snapshot.nodes });
    this.actions.set({ status: 'ready', error: null, value: snapshot.actions });
    for (const event of replay) {
      if (event.type === 'node.changed') {
        this.applyNode(event.node);
      } else if (event.type === 'node_action.recorded') {
        this.applyAction(event.action);
      }
    }
  }
}
