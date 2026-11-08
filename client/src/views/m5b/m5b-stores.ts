// 工具组几页和站内信在客户端的副本（都是 ResourceStore，规矩见 resource-store.ts）。每样怎么把事件并进手里那一份写在这里：
// 一行按版本换；合计、排序、所在的分类可能变了的，再拉一份按服务端的校准（不自己猜）。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type {
  BrowserViewDto,
  FileListResponse,
  InboxBoxId,
  InboxListResponse,
  InboxMessageView,
  InboxUnread,
  MoneyResponse,
  ToolGroupListResponse,
  TrashListResponse,
} from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { Store } from '../../state/store.ts';
import { deviceTimeZone as localTimeZone } from '../../state/time-zone.ts';
import { replaceByVersion, ResourceStore, type Merge, type Resource } from './resource-store.ts';

const NO_CHANGE = null;

export function currentMonth(now: Date, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  return format.format(now).slice(0, 7);
}

function mergeMoney(value: MoneyResponse, event: LiveEvent): Merge<MoneyResponse> | null {
  if (event.type !== 'money.changed') {
    return NO_CHANGE;
  }
  // The day's sums and the balances move with any entry: replace what can be replaced, then recalibrate.
  const days = value.days.map((day) => ({ ...day, entries: replaceByVersion(day.entries, event.entry).rows }));
  return { value: { ...value, days }, refetch: true };
}




function mergeToolGroups(value: ToolGroupListResponse, event: LiveEvent): Merge<ToolGroupListResponse> | null {
  if (event.type !== 'tool_group.changed') {
    return NO_CHANGE;
  }
  const groups = value.groups.map((group) =>
    group.id === event.group.id && group.version < event.group.version ? event.group : group,
  );
  return { value: { groups }, refetch: false };
}

function mergeBrowser(value: BrowserViewDto, event: LiveEvent): Merge<BrowserViewDto> | null {
  if (event.type !== 'browser.changed') {
    return NO_CHANGE;
  }
  const incoming = event.browser.updatedAt;
  const older = value.updatedAt !== null && incoming !== null && incoming < value.updatedAt;
  return older ? NO_CHANGE : { value: event.browser, refetch: false };
}



function mergeMessage(value: InboxMessageView, event: LiveEvent): Merge<InboxMessageView> | null {
  if (event.type !== 'inbox.changed' || event.message.id !== value.id || event.message.version <= value.version) {
    return NO_CHANGE;
  }
  return { value: { ...value, ...event.message }, refetch: false };
}

/**
 * 站内信：一个分类的列表和没读的数。铃和站内信页第 113 条去掉了（邮件和系统来源并进联系人），这里只剩「设置 · 通知记录」
 * 读 Plasticine 那一类，打开那一段才拉。
 */
export class InboxStore {
  readonly list: ResourceStore<InboxListResponse>;
  readonly message: ResourceStore<InboxMessageView>;
  readonly unread = new Store<InboxUnread | null>(null);
  readonly box = new Store<InboxBoxId>('all');
  readonly query = new Store('');
  private readonly api: PlasticineApi;
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.list = new ResourceStore(hub, () => this.fetch(), (value, event) => this.mergeList(value, event));
    this.message = new ResourceStore(hub, () => Promise.reject(new Error('还没打开哪一封')), mergeMessage);
    this.stopListening = hub.on((event) => {
      if (event.type === 'inbox.changed') {
        this.unread.set(event.unread);
      }
    });
  }

  start(): void {
    this.list.start();
    this.message.start();
  }

  stop(): void {
    this.list.stop();
    this.message.stop();
    this.stopListening?.();
    this.stopListening = null;
  }

  showBox(box: InboxBoxId): void {
    this.box.set(box);
    void this.list.refetchWith(() => this.fetch());
  }

  search(query: string): void {
    this.query.set(query.trim());
    void this.list.refetchWith(() => this.fetch());
  }

  openMessage(id: string): void {
    void this.message.refetchWith(() => this.api.inbox.get(id));
  }

  private async fetch(): Promise<InboxListResponse> {
    const query = this.query.get();
    const response = await this.api.inbox.list({ box: this.box.get(), ...(query === '' ? {} : { q: query }) });
    this.unread.set(response.unread);
    return response;
  }

  private mergeList(value: InboxListResponse, event: LiveEvent): Merge<InboxListResponse> | null {
    if (event.type !== 'inbox.changed') {
      return NO_CHANGE;
    }
    const replaced = replaceByVersion(value.messages, event.message);
    // A new message, or one that may have left this box (read in 未读, archived …): ask the server.
    return { value: { ...value, messages: replaced.rows, unread: event.unread }, refetch: true };
  }
}

/** 成果：按 id 的一份（对话里的成果卡片用），事件来了按行版本换。 */
export interface M5bStores {
  money: ResourceStore<MoneyResponse>;
  moneyMonth: Store<string>;
  inbox: InboxStore;
  toolGroups: ResourceStore<ToolGroupListResponse>;
  files: ResourceStore<FileListResponse>;
  folder: Store<string>;
  trash: ResourceStore<TrashListResponse>;
  browser: ResourceStore<BrowserViewDto>;
  timeZone: string;
  setTimeZone: (timeZone: string) => void;
}

export function createM5bStores(
  api: PlasticineApi, hub: EventsHub, now: () => Date, initialTimeZone = localTimeZone(),
): M5bStores {
  let timeZone = initialTimeZone;
  const moneyMonth = new Store(currentMonth(now(), timeZone));
  const folder = new Store('');
  const stores: M5bStores = {
    money: new ResourceStore(hub, () => api.money.month({ month: moneyMonth.get(), tz: timeZone }), mergeMoney),
    moneyMonth,
    inbox: new InboxStore(api, hub),
    toolGroups: new ResourceStore(hub, () => api.toolGroups.list(), mergeToolGroups),
    files: new ResourceStore(hub, () => api.files.list(folder.get()), () => NO_CHANGE),
    folder,
    trash: new ResourceStore(hub, () => api.files.trashed(), () => NO_CHANGE),
    browser: new ResourceStore(hub, () => api.browser.get(), mergeBrowser),
    get timeZone() { return timeZone; },
    setTimeZone: (next) => {
      if (timeZone === next) {
        return;
      }
      const oldMonth = currentMonth(now(), timeZone);
      timeZone = next;
      if (moneyMonth.get() === oldMonth) {
        moneyMonth.set(currentMonth(now(), timeZone));
      }
      if (stores.money.data.get().status !== 'idle') {
        void stores.money.reset();
      }
    },
  };
  return stores;
}

export function startM5bStores(stores: M5bStores): () => void {
  const resources = [
    stores.money,
    stores.toolGroups,
    stores.files,
    stores.trash,
    stores.browser,
  ];
  for (const resource of resources) {
    resource.start();
  }
  stores.inbox.start();
  return () => {
    for (const resource of resources) {
      resource.stop();
    }
    stores.inbox.stop();
  };
}
