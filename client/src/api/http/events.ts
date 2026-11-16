// /v2/events 的真实现：一条 EventSource。断线后浏览器自己重连，并带上 Last-Event-ID 让服务端补发；
// 浏览器放弃了（readyState = CLOSED，例如 401 或服务没起来）才报 closed，由 EventsHub 退避后重新订阅，
// 这时新连接用 ?lastEventId= 接上（EventSource 第一次连接不能自己设请求头）。服务端的第一条 ready 就带着起点
// 位置的 id，所以连上之后还没来过别的事件也接得上。补不上时服务端先发 ready{resync:true}，映射成 resync。
// 每条事件先过 shared 的 EveryStreamEventSchema（卡、记忆和约定、信息流、节点和设备动作、记账、站内信、工具组、
// 云端浏览器、联系人），线的事件过 LineStreamEventSchema。

import type { Static, TSchema } from 'typebox';
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
  notify: true,
  notify_kinds_changed: true,
  attachment_changed: true,
  money_draft_changed: true,
  client_version_changed: true,
  backups_changed: true,
  tasks_changed: true,
  calendar_changed: true,
  video_changed: true,
  transcriber_changed: true,
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
  /** 认不出事件时怎么刷新整页（测试给假的）；默认 BROWSER_STALE。 */
  stale?: StaleHandling;
}

/**
 * 认不出的事件（11-16）：以前每来一条就整份重拉一次（线列表 + 打开过的每条线）。18:06 换版后线多了一个字段，
 * 没刷新的旧页面每条「线变了」都认不出，一分钟几百个请求，把服务压垮了。现在：多出来的字段先删掉再认（新服务多给的
 * 东西旧页面用不上）；还认不出才重拉，而且一分钟最多一次；重拉过还是认不出，说明这一页是旧代码，刷新整页（十分钟最多一次）。
 */
const RESYNC_EVERY_MS = 60_000;
const RELOAD_EVERY_MS = 10 * 60_000;
const RELOAD_KEY = 'plasticine.staleReloadAt';

export interface StaleHandling {
  now(): number;
  /** 刷新整页（旧代码认不出新服务的事件）。 */
  reload(): void;
  /** 上次因为这个刷新整页是什么时候（存在本页会话里，拿不到是 null）。 */
  lastReload(): number | null;
  markReload(at: number): void;
}

export const BROWSER_STALE: StaleHandling = {
  now: () => Date.now(),
  reload: () => window.location.reload(),
  lastReload: () => {
    try {
      const value = Number(window.sessionStorage.getItem(RELOAD_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      // 拿不到会话存储（隐私模式之类）：当没刷过。
      return null;
    }
  },
  markReload: (at) => {
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(at));
    } catch (error) {
      // 存不了就算了：最坏多刷新一次。
      console.warn('记不下刷新时间', error);
    }
  },
};

function parseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn('事件流里有一条不是 JSON 的数据', error);
    return undefined;
  }
}

/** 认得出就回它；多了字段（新服务多给的）删掉再认；还认不出回 null。 */
function recognized<T extends TSchema>(schema: T, value: unknown): Static<T> | null {
  if (Value.Check(schema, value)) {
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const cleaned = Value.Clean(schema, structuredClone(value));
  return Value.Check(schema, cleaned) ? cleaned : null;
}

export class HttpEvents implements EventsApi {
  private readonly options: HttpEventsOptions;
  private readonly mapper: ServerEventMapper;
  /** 最后一条带 id 的事件；浏览器放弃之后重新订阅时用它接上。 */
  private lastEventId: string | null = null;
  /** 上次因为认不出事件重拉的时间；重拉过以后又认不出的条数。 */
  private resyncedAt: number | null = null;
  private strayAfterResync = 0;

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
    const value = recognized(LineStreamEventSchema, parseData(event.data));
    if (value === null || value.type !== type) {
      return this.stray(type);
    }
    return [{ type: 'line', event: value }];
  }

  private receive(type: string, event: MessageEvent<string>): LiveEvent[] {
    if (event.lastEventId !== '') {
      this.lastEventId = event.lastEventId;
    }
    const value = recognized(EveryStreamEventSchema, parseData(event.data));
    if (value === null || value.type !== type) {
      // 认不出的事件可能正是改了界面的那一条：不猜，当作补不上了，重新拉一遍（一分钟最多一次）。
      this.mapper.reset();
      return this.stray(type);
    }
    return this.mapper.apply(value);
  }

  /** 认不出一条事件：一分钟里只重拉一次；重拉过还认不出就是旧代码，刷新整页（十分钟最多一次）。 */
  private stray(type: string): LiveEvent[] {
    const stale = this.options.stale ?? BROWSER_STALE;
    const now = stale.now();
    if (this.resyncedAt !== null && now - this.resyncedAt < RESYNC_EVERY_MS) {
      this.strayAfterResync += 1;
      const last = stale.lastReload();
      if (this.strayAfterResync >= 2 && (last === null || now - last >= RELOAD_EVERY_MS)) {
        console.warn(`事件流里的 ${type} 这一页一直认不出，多半是新版本上线了，刷新整页`);
        stale.markReload(now);
        stale.reload();
      }
      return [];
    }
    console.warn(`事件流里有一条认不出的 ${type} 事件，重新拉一遍`);
    this.resyncedAt = now;
    this.strayAfterResync = 0;
    return [{ type: 'resync' }];
  }
}
