import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../state/events-hub.ts';
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
import { ResourceStore, type Merge } from '../../state/resource-store.ts';

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
