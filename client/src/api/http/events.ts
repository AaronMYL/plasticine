import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { EventsApi } from '../client.ts';
import { EVENTS_PATH, EveryStreamEventSchema, LineStreamEventSchema, type LineStreamEvent } from '../shared.ts';
import type { EventHandlers, EveryStreamEvent, LiveEvent } from '../types.ts';
import { ServerEventMapper } from './event-mapper.ts';
import type { LocalEvents } from './local-events.ts';

export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type CreateEventSource = (url: string) => EventSourceLike;

export const EVENT_SOURCE_CLOSED = 2;

const STREAM_EVENT_TYPES: Readonly<Record<EveryStreamEvent['type'], true>> = {
  ready: true,
  notify: true,
  notify_kinds_changed: true,
  attachment_changed: true,
  money_draft_changed: true,
  client_version_changed: true,
  backups_changed: true,
  tasks_changed: true,
  pushes_changed: true,
  connections_changed: true,
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
  contacts_changed: true,
  contact_item: true,
};

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
  onGiveUp: () => void;
  now?: () => Date;
  stale?: StaleHandling;
}

const RESYNC_EVERY_MS = 60_000;
const RELOAD_EVERY_MS = 10 * 60_000;
const RELOAD_KEY = 'plasticine.staleReloadAt';

export interface StaleHandling {
  now(): number;
  reload(): void;
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
      return null;
    }
  },
  markReload: (at) => {
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(at));
    } catch (error) {
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
  private lastEventId: string | null = null;
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
      this.mapper.reset();
      return this.stray(type);
    }
    return this.mapper.apply(value);
  }

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
