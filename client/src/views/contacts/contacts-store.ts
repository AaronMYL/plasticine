// 联系人在客户端的副本（第 113 条）：一张列表（登录后就读，侧栏和底栏的等你点要它）、每个打开过的联系人一段聊天和一份
// 资料。都是 ResourceStore（打开才拉、拉的期间到的事件拉回来再放一遍、读失败说原因）。事件怎么并：
// contacts_changed → 列表换上等你数和未读数，再拉一份按服务端的校准；contact_item → 那段聊天里按身份换（一句话按 id、
// 任务卡按任务 id 且只换更新的、AI↔AI 那一段按 exchange id，收进那一段的单句拿掉），列表的最后一句再拉一份；
// 任务卡变了，那人的资料（交付记录）也再拉一份。往上翻的更早几页另放一处，和最新一页按身份去重。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type {
  ContactDetail,
  ContactListResponse,
  ContactMessagesResponse,
  ContactRow,
  ContactThreadItem,
} from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import { ResourceStore, type Merge } from '../m5b/resource-store.ts';

export function itemKey(item: ContactThreadItem): string {
  switch (item.type) {
    case 'message':
      return `m:${item.message.id}`;
    case 'task':
      return `t:${item.task.id}`;
    case 'group_task':
      return `g:${item.task.id}`;
    case 'exchange':
      return `x:${item.id}`;
  }
}

export function itemTime(item: ContactThreadItem): string {
  return item.type === 'message' ? item.message.at : item.at;
}

/** 一段聊天里放进（或换掉）一项；任务卡只换更新的。返回 null 表示没有变化。 */
export function upsertItem(items: readonly ContactThreadItem[], item: ContactThreadItem): ContactThreadItem[] | null {
  const key = itemKey(item);
  const held = items.find((candidate) => itemKey(candidate) === key);
  if (held?.type === 'task' && item.type === 'task' && held.task.version >= item.task.version) {
    return null;
  }
  if (held?.type === 'group_task' && item.type === 'group_task' && held.task.version > item.task.version) {
    return null;
  }
  const inExchange = item.type === 'message' && items.some((candidate) => candidate.type === 'exchange'
    && candidate.messages.some((message) => message.id === item.message.id));
  if (inExchange) {
    return null;
  }
  // 收进一段 AI↔AI 的单句不再单独摆。
  const folded = item.type === 'exchange' ? new Set(item.messages.map((message) => `m:${message.id}`)) : null;
  const kept = (candidate: ContactThreadItem): boolean => !(folded?.has(itemKey(candidate)) ?? false);
  if (held !== undefined) {
    return items.map((candidate) => (itemKey(candidate) === key ? item : candidate)).filter(kept);
  }
  const rest = items.filter(kept);
  const at = itemTime(item);
  const index = rest.findIndex((candidate) => itemTime(candidate) > at);
  if (index < 0) {
    return [...rest, item];
  }
  return [...rest.slice(0, index), item, ...rest.slice(index)];
}

/** 两段按身份去重地接起来（更早的几页在前）。 */
export function joinItems(earlier: readonly ContactThreadItem[], latest: readonly ContactThreadItem[]) {
  const seen = new Set(latest.map(itemKey));
  return [...earlier.filter((item) => !seen.has(itemKey(item))), ...latest];
}

function mergeList(value: ContactListResponse, event: LiveEvent): Merge<ContactListResponse> | null {
  if (event.type === 'contacts.changed') {
    return { value: { ...value, waiting: event.waiting, unread: event.unread }, refetch: true };
  }
  if (event.type === 'contact.item') {
    return { value, refetch: true };
  }
  return null;
}

export interface EarlierPages {
  status: LoadStatus;
  error: string | null;
  items: ContactThreadItem[];
  /** null = 还没往上翻过，看最新一页的 hasMore。 */
  hasMore: boolean | null;
}

export class ContactThread {
  readonly latest: ResourceStore<ContactMessagesResponse>;
  readonly earlier = new Store<EarlierPages>({ status: 'idle', error: null, items: [], hasMore: null });
  private readonly api: PlasticineApi;
  private readonly contactId: string;

  constructor(api: PlasticineApi, hub: EventsHub, contactId: string) {
    this.api = api;
    this.contactId = contactId;
    this.latest = new ResourceStore(hub, () => api.contacts.messages(contactId, {}),
      (value, event) => this.merge(value, event));
  }

  /** 一项变了（写操作的回答，或事件）：就地换。 */
  put(item: ContactThreadItem): void {
    this.latest.apply({ type: 'contact.item', contactId: this.contactId, item });
  }

  async loadEarlier(): Promise<void> {
    const pages = this.earlier.get();
    const latest = this.latest.data.get().value;
    const first = pages.items[0] ?? latest?.items[0];
    if (pages.status === 'loading' || first === undefined) {
      return;
    }
    this.earlier.set({ ...pages, status: 'loading', error: null });
    try {
      const page = await this.api.contacts.messages(this.contactId, { before: itemTime(first) });
      this.earlier.set((held) => ({ status: 'ready', error: null, items: joinItems(page.items, held.items),
        hasMore: page.hasMore }));
    } catch (cause) {
      this.earlier.set((held) => ({ ...held, status: 'failed', error: errorText(cause) }));
    }
  }

  private merge(value: ContactMessagesResponse, event: LiveEvent): Merge<ContactMessagesResponse> | null {
    if (event.type !== 'contact.item' || event.contactId !== this.contactId) {
      return null;
    }
    const items = upsertItem(value.items, event.item);
    return items === null ? null : { value: { ...value, items }, refetch: false };
  }
}

export class ContactsStore {
  readonly list: ResourceStore<ContactListResponse>;
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private readonly threads = new Map<string, ContactThread>();
  private readonly details = new Map<string, ResourceStore<ContactDetail>>();
  private started = false;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.hub = hub;
    this.list = new ResourceStore(hub, () => api.contacts.list(), mergeList);
  }

  start(): void {
    this.started = true;
    this.list.start();
    // 侧栏和底栏每页都有联系人的等你点：登录后就读一次，之后跟着事件走。
    this.list.open();
    for (const thread of this.threads.values()) {
      thread.latest.start();
    }
    for (const detail of this.details.values()) {
      detail.start();
    }
  }

  stop(): void {
    this.started = false;
    this.list.stop();
    for (const thread of this.threads.values()) {
      thread.latest.stop();
    }
    for (const detail of this.details.values()) {
      detail.stop();
    }
  }

  row(id: string): ContactRow | undefined {
    return this.list.data.get().value?.contacts.find((row) => row.id === id);
  }

  thread(id: string): ContactThread {
    let thread = this.threads.get(id);
    if (thread === undefined) {
      thread = new ContactThread(this.api, this.hub, id);
      this.threads.set(id, thread);
      if (this.started) {
        thread.latest.start();
      }
    }
    return thread;
  }

  detail(id: string): ResourceStore<ContactDetail> {
    let detail = this.details.get(id);
    if (detail === undefined) {
      detail = new ResourceStore(this.hub, () => this.api.contacts.get(id), (value, event) => {
        // 任务卡变了，交付记录跟着变：再拉一份。
        const touched = event.type === 'contact.item' && event.contactId === id && event.item.type === 'task';
        return touched ? { value, refetch: true } : null;
      });
      this.details.set(id, detail);
      if (this.started) {
        detail.start();
      }
    }
    return detail;
  }

  /** 一行变了（写操作的回答）：比手里新就换上，再拉一份校准顺序和总数。 */
  putRow(row: ContactRow): void {
    const value = this.list.data.get().value;
    if (value === null) {
      return;
    }
    const contacts = value.contacts.map((held) => (held.id === row.id && held.version <= row.version ? row : held));
    this.list.data.set((data) => ({ ...data, value: { ...value, contacts } }));
    void this.list.reload();
  }
}
