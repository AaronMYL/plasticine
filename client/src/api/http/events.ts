// /v2/events 的真实现：一条 EventSource。断线后浏览器自己重连，并带上 Last-Event-ID 让服务端补发；
// 浏览器放弃了（readyState = CLOSED，例如 401 或服务没起来）才报 closed，由 EventsHub 退避后重新订阅，
// 这时新连接用 ?lastEventId= 接上（EventSource 第一次连接不能自己设请求头）。服务端的第一条 ready 就带着起点
// 位置的 id，所以连上之后还没来过别的事件也接得上。补不上时服务端先发 ready{resync:true}，映射成 resync。
// 每条事件先过 shared 的 EveryStreamEventSchema（卡、记忆和约定、信息流、节点和设备动作、记账、站内信、工具组、
// 云端浏览器、联系人），线的事件过 LineStreamEventSchema。

import { Value } from 'typebox/value';
import type { EventsApi } from '../client.ts';
import { EVENTS_PATH, EveryStreamEventSchema, LineStreamEventSchema, type LineStreamEvent } from '../shared.ts';
import type { EventHandlers, EveryStreamEvent, LiveEvent } from '../types.ts';
import { ServerEventMapper } from './event-mapper.ts';
import type { LocalEvents } from './local-events.ts';

/** EventSource 里用到的部分；测试给假的。 */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type CreateEventSource = (url: string) => EventSourceLike;

/** EventSource.CLOSED：浏览器不会再自己重连了。写成数，测试环境里没有 EventSource 这个全局。 */
export const EVENT_SOURCE_CLOSED = 2;

// 用 Record 列出全部事件：shared 里多了一种而这里没写，typecheck 就不过。
const STREAM_EVENT_TYPES: Readonly<Record<EveryStreamEvent['type'], true>> = {
  ready: true,
  attachment_changed: true,
  money_draft_changed: true,
  client_version_changed: true,
  backups_changed: true,
  tasks_changed: true,
  calendar_changed: true,
  video_changed: true,
  space_changed: true,
  web_tabs_changed: true,
  bookmarks_changed: true,
  note_invalidated: true,
  project_invalidated: true,
  book_changed: true,
  ask_created: true,
  ask_answered: true,
  ask_updated: true,
  memory_entry_changed: true,
  agreement_changed: true,
  feed_item_changed: true,
  node_changed: true,
  node_action_recorded: true,
  money_changed: true,
  inbox_changed: true,
  tool_group_changed: true,
  browser_changed: true,
  // 第 113 条：联系人。
  contacts_changed: true,
  contact_item: true,
};

// 新内核的线事件另成一组（shared/api/lines.ts：不并进 EveryStreamEventSchema），各自按 LineStreamEventSchema 校验。
const LINE_EVENT_TYPES: Readonly<Record<LineStreamEvent['type'], true>> = {
  line_changed: true,
  line_text: true,
  line_thinking: true,
  line_tool: true,
  line_message: true,
  line_queue: true,
};

export interface HttpEventsOptions {
  createSource: CreateEventSource;
  local: LocalEvents;
  /** 浏览器放弃重连时调：去问一次会话，401 就会经接口层回到配对页。 */
  onGiveUp: () => void;
  now?: () => Date;
}

function parseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn('事件流里有一条不是 JSON 的数据', error);
    return undefined;
  }
}

export class HttpEvents implements EventsApi {
  private readonly options: HttpEventsOptions;
  private readonly mapper: ServerEventMapper;
  /** 最后一条带 id 的事件；浏览器放弃之后重新订阅时用它接上。 */
  private lastEventId: string | null = null;

  constructor(options: HttpEventsOptions) {
    this.options = options;
    this.mapper = new ServerEventMapper();
  }

  resumable(): boolean {
    return this.lastEventId !== null;
  }

  subscribe(handlers: EventHandlers, signal?: AbortSignal): () => void {
    const query = this.lastEventId === null ? '' : `?lastEventId=${encodeURIComponent(this.lastEventId)}`;
    handlers.onStatus('connecting');
    const source = this.options.createSource(`${EVENTS_PATH}${query}`);
    let active = true;
    const deliver = (events: LiveEvent[]): void => {
      for (const event of events) {
        if (active) {
          handlers.onEvent(event);
        }
      }
    };
    const stopLocal = this.options.local.on((event) => deliver([event]));
    const close = (): void => {
      if (!active) {
        return;
      }
      active = false;
      source.close();
      stopLocal();
      signal?.removeEventListener('abort', unsubscribe);
      handlers.onStatus('closed');
    };
    const unsubscribe = (): void => {
      close();
    };
    source.onopen = () => {
      if (active) {
        handlers.onStatus('open');
      }
    };
    source.onerror = () => {
      if (!active) {
        return;
      }
      if (source.readyState === EVENT_SOURCE_CLOSED) {
        close();
        this.options.onGiveUp();
      } else {
        handlers.onStatus('connecting');
      }
    };
    for (const type of Object.keys(STREAM_EVENT_TYPES)) {
      source.addEventListener(type, (event) => deliver(this.receive(type, event)));
    }
    for (const type of Object.keys(LINE_EVENT_TYPES)) {
      source.addEventListener(type, (event) => deliver(this.receiveLine(type, event)));
    }
    signal?.addEventListener('abort', unsubscribe, { once: true });
    return unsubscribe;
  }

  private receiveLine(type: string, event: MessageEvent<string>): LiveEvent[] {
    if (event.lastEventId !== '') {
      this.lastEventId = event.lastEventId;
    }
    const value = parseData(event.data);
    if (!Value.Check(LineStreamEventSchema, value) || value.type !== type) {
      console.warn(`事件流里有一条认不出的 ${type} 事件，重新拉一遍`, event.data);
      return [{ type: 'resync' }];
    }
    return [{ type: 'line', event: value }];
  }

  private receive(type: string, event: MessageEvent<string>): LiveEvent[] {
    if (event.lastEventId !== '') {
      this.lastEventId = event.lastEventId;
    }
    const value = parseData(event.data);
    if (!Value.Check(EveryStreamEventSchema, value) || value.type !== type) {
      // 认不出的事件可能正是改了界面的那一条：不猜，当作补不上了，重新拉一遍。
      console.warn(`事件流里有一条认不出的 ${type} 事件，重新拉一遍`, event.data);
      this.mapper.reset();
      return [{ type: 'resync' }];
    }
    return this.mapper.apply(value);
  }
}
