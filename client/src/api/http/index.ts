import { HttpClientUpdates } from './client-updates.ts';
import { HttpBackups } from './backups.ts';
import { HttpSearch } from './search.ts';
import { HttpSystems } from './systems.ts';
// 真接口：把各资源文件和事件流装成一个 PlasticineApi。fetch 和 EventSource 可以换成假的（测试用），
// 默认用浏览器自己的；同源请求，会话在 HttpOnly cookie 里，前端不碰。

import { HttpLines, HttpModelProviders } from './lines.ts';
import { HttpTasks } from './tasks.ts';
import { HttpTranslate } from './translate.ts';
import type { PlasticineApi } from '../client.ts';
import { HttpAccount } from './account.ts';
import { HttpAgreements } from './agreements.ts';
import { HttpAttachments } from './attachments.ts';
import { HttpBooks } from './books.ts';
import { createBookmarksHttp } from './bookmarks.ts';
import { createWebTabsHttp } from './web-tabs.ts';
import { HttpMoneyDrafts } from './money-drafts.ts';
import { HttpAsks } from './asks.ts';
import { HttpContacts, HttpGroupTasks, HttpNetworkTasks } from './contacts.ts';
import { HttpNetwork, HttpVisibility } from './network.ts';
import { HttpProjects } from './projects.ts';
import { HttpDeviceKeys } from './device-keys.ts';
import { HttpDevices } from './devices.ts';
import { HttpEvents, type CreateEventSource } from './events.ts';
import { HttpFeed } from './feed.ts';
import { LocalEvents } from './local-events.ts';
import { createM5bHttp } from './m5b.ts';
import { HttpMemory } from './memory.ts';
import { HttpNotes } from './notes.ts';
import { HttpPush } from './push.ts';
import { HttpNodes } from './nodes.ts';
import { HttpSession } from './session.ts';
import { HttpSigned } from './signed.ts';
import { HttpToday } from './today.ts';
import { createThingsHttp } from './things.ts';
import { createSpacesHttp } from './spaces.ts';
import { Transport, type FetchLike } from './transport.ts';

export interface HttpApiOptions {
  fetch?: FetchLike;
  createEventSource?: CreateEventSource;
  timeoutMs?: number;
  now?: () => Date;
}

export function createHttpApi(options: HttpApiOptions = {}): PlasticineApi {
  const listeners = new Set<() => void>();
  const transport = new Transport({
    fetch: options.fetch ?? ((url, init) => window.fetch(url, init)),
    onUnauthorized: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const local = new LocalEvents();
  const session = new HttpSession(transport);
  const events = new HttpEvents({
    createSource: options.createEventSource ?? ((url) => new EventSource(url)),
    local,
    onGiveUp: () => {
      // 只为了看是不是 401：是的话接口层已经通知了壳；其他错误留给 EventsHub 的重连，这里记一笔。
      session.current().catch((cause: unknown) => console.warn('事件流断了，查登录状态也没成功', cause));
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    lines: new HttpLines(transport),
    tasks: new HttpTasks(transport),
    modelProviders: new HttpModelProviders(transport),
    search: new HttpSearch(transport),
    systems: new HttpSystems(transport),
    translate: new HttpTranslate(transport),
    session,
    account: new HttpAccount(transport),
    devices: new HttpDevices(transport),
    attachments: new HttpAttachments(transport),
    moneyDrafts: new HttpMoneyDrafts(transport),
    clientUpdates: new HttpClientUpdates(transport),
    backups: new HttpBackups(transport),
    notes: new HttpNotes(transport, local),
    books: new HttpBooks(transport),
    bookmarks: createBookmarksHttp(transport),
    webTabs: createWebTabsHttp(transport),
    asks: new HttpAsks(transport),
    push: new HttpPush(transport),
    memory: new HttpMemory(transport),
    agreements: new HttpAgreements(transport),
    deviceKeys: new HttpDeviceKeys(transport),
    signed: new HttpSigned(transport),
    projects: new HttpProjects(transport),
    today: new HttpToday(transport),
    feed: new HttpFeed(transport),
    nodes: new HttpNodes(transport),
    ...createM5bHttp(transport),
    ...createThingsHttp(transport),
    ...createSpacesHttp(transport),
    contacts: new HttpContacts(transport),
    networkTasks: new HttpNetworkTasks(transport),
    groupTasks: new HttpGroupTasks(transport),
    network: new HttpNetwork(transport),
    visibility: new HttpVisibility(transport),
    events,
    onUnauthorized: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
