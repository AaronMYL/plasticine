// 设置里「账号与网络」「对外可见」两段的数据和写操作（第 113 条）。打开那一段才拉；写操作的标识和请求体在 action-ops，
// 表单的字在 inline-drafts，拿到结果才清。刚生成的邀请码（带一句能复制给朋友的话）只留在这一次打开里，列表里照样有码。

import type { PlasticineApi } from '../../api/client.ts';
import type { NetworkInviteResponse } from '../../api/contacts-client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { MaterialRow, NetworkInvite, NetworkStatus, Tier, VisibilityResponse } from '../../api/shared.ts';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import {
  NETWORK_INVITE_OP_KEY,
  NETWORK_JOIN_OP_KEY,
  VISIBILITY_CONFIRM_OP_KEY,
  visibilityOpKey,
} from '../../state/contacts-action-requests.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { Store } from '../../state/store.ts';
import { ResourceStore } from '../m5b/resource-store.ts';

export type JoinField = 'handle' | 'displayName' | 'inviteCode';

export function joinDraftKey(field: JoinField): string {
  return `${NETWORK_JOIN_OP_KEY}:${field}`;
}

export class NetworkStore {
  readonly status: ResourceStore<NetworkStatus>;
  readonly invites: ResourceStore<NetworkInvite[]>;
  readonly visibility: ResourceStore<VisibilityResponse>;
  /** 刚生成的那一个（显示码和可以复制的那句话）。 */
  readonly fresh = new Store<NetworkInviteResponse | null>(null);

  constructor(api: PlasticineApi, hub: EventsHub) {
    // 网络和可见的变化没有自己的事件：写操作的回答直接换上，resync 时再拉一份。
    this.status = new ResourceStore(hub, () => api.network.status(), () => null);
    this.invites = new ResourceStore(hub, () => api.network.invites(), () => null);
    this.visibility = new ResourceStore(hub, () => api.visibility.get(), () => null);
  }

  start(): void {
    this.status.start();
    this.invites.start();
    this.visibility.start();
  }

  stop(): void {
    this.status.stop();
    this.invites.stop();
    this.visibility.stop();
  }
}

export interface NetworkActionsDeps {
  api: PlasticineApi;
  store: NetworkStore;
  ops: ActionOps;
  drafts: InlineDrafts;
}

export class NetworkActions {
  private readonly deps: NetworkActionsDeps;

  constructor(deps: NetworkActionsDeps) {
    this.deps = deps;
  }

  async retry(key: string): Promise<void> {
    const request = this.deps.ops.retry(key);
    if (request !== undefined) {
      await this.perform(key, request);
    }
  }

  async join(): Promise<boolean> {
    const { drafts } = this.deps;
    const handle = drafts.get(joinDraftKey('handle')).trim().replace(/^@/, '');
    const displayName = drafts.get(joinDraftKey('displayName')).trim();
    const inviteCode = drafts.get(joinDraftKey('inviteCode')).trim();
    if (handle === '' || displayName === '') {
      return false;
    }
    return this.run(NETWORK_JOIN_OP_KEY, '加入网络', `@${handle}`, (requestId) => ({
      kind: 'network_join',
      body: inviteCode === '' ? { requestId, handle, displayName } : { requestId, handle, displayName, inviteCode },
    }));
  }

  async invite(): Promise<boolean> {
    return this.run(NETWORK_INVITE_OP_KEY, '邀请朋友', '邀请码', (requestId) => ({
      kind: 'network_invite',
      body: { requestId },
    }));
  }

  async mark(row: MaterialRow, tier: Tier): Promise<boolean> {
    if (row.tier === tier && row.proposed === null) {
      return true;
    }
    return this.run(visibilityOpKey(row.kind, row.id), '定档', row.title, (requestId) => ({
      kind: 'visibility_mark',
      body: { requestId, kind: row.kind, id: row.id, tier, version: row.version },
    }));
  }

  async confirmAll(): Promise<boolean> {
    return this.run(VISIBILITY_CONFIRM_OP_KEY, '全部确认', 'Plasticine 的建议', (requestId) => ({
      kind: 'visibility_confirm',
      body: { requestId },
    }));
  }

  private async run(key: string, label: string, subject: string,
    build: (requestId: string) => ActionRequest): Promise<boolean> {
    if (this.deps.ops.get(key)?.status === 'failed') {
      this.deps.ops.dismiss(key);
    }
    const request = this.deps.ops.begin(key, label, subject, build, createRequestId);
    return this.perform(key, request);
  }

  private async perform(key: string, request: ActionRequest): Promise<boolean> {
    try {
      await this.send(request);
      this.deps.ops.succeed(key);
      return true;
    } catch (cause) {
      this.deps.ops.fail(key, cause);
      // 版本旧了或已经变了：再拉一份，看着现在的样子再定。
      void this.deps.store.visibility.reload();
      return false;
    }
  }

  private async send(request: ActionRequest): Promise<void> {
    const { api, store, drafts } = this.deps;
    switch (request.kind) {
      case 'network_join': {
        await api.network.join(request.body);
        for (const field of ['handle', 'displayName', 'inviteCode'] as const) {
          drafts.clear(joinDraftKey(field));
        }
        await store.status.reload();
        return;
      }
      case 'network_invite': {
        store.fresh.set(await api.network.createInvite(request.body));
        await store.invites.reload();
        return;
      }
      case 'visibility_mark':
      case 'visibility_confirm': {
        const matrix = request.kind === 'visibility_mark' ? await api.visibility.mark(request.body)
          : await api.visibility.confirm(request.body);
        store.visibility.data.set({ status: 'ready', error: null, value: matrix });
        return;
      }
      default:
        throw new Error(`网络设置的写操作里没有「${request.kind}」`);
    }
  }
}
