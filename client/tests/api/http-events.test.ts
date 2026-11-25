import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsHub } from '../../src/state/events-hub.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { ConnectionStatus, EveryStreamEvent, LiveEvent } from '../../src/api/types.ts';
import {
  askView,
  eventSources,
  fakeFetch,
  json,
  type FakeEventSource,
} from './http-fixtures.ts';

const NOW = new Date('2026-10-27T02:00:00.000Z');
const UNAUTHORIZED = { error: '这台设备还没登录。', code: 'unauthorized', next: '重新配对。' };

let clock = 0;
const reloads: number[] = [];
let lastReload: number | null = null;
const stale = { now: () => clock, reload: () => reloads.push(clock), lastReload: () => lastReload,
  markReload: (at: number) => { lastReload = at; } };

function connect(...responses: Array<ReturnType<typeof json>>) {
  const sources = eventSources();
  const { fetch, calls } = fakeFetch(...responses.map((response) => () => response));
  clock = 1_000_000;
  reloads.length = 0;
  lastReload = null;
  const http = createHttpApi({ fetch, createEventSource: sources.create, now: () => NOW, stale });
  const unauthorized = vi.fn();
  http.onUnauthorized(unauthorized);
  const events: LiveEvent[] = [];
  const statuses: ConnectionStatus[] = [];
  const unsubscribe = http.events.subscribe({
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
  });
  const source = sources.created[0];
  if (source === undefined) {
    throw new Error('没有建 EventSource');
  }
  return { http, sources, source, events, statuses, unsubscribe, calls, unauthorized };
}

function push(source: FakeEventSource, event: EveryStreamEvent, id = ''): void {
  source.emit(event.type, event, id);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Real event stream - connection', () => {
  it('Connects /v2/events, binds all business/line listeners, emits open on connect', () => {
    const { source, statuses } = connect();
    expect(source.url).toBe('/v2/events');
    expect(source.types).toEqual(
      [
        'ready', 'attachment_changed', 'money_draft_changed', 'client_version_changed', 'backups_changed',
          'tasks_changed', 'pushes_changed', 'connections_changed',
        'note_invalidated', 'project_invalidated', 'book_changed', 'ask_created', 'ask_answered', 'ask_updated',
        'memory_entry_changed', 'calendar_changed',
        'feed_item_changed', 'node_changed', 'node_action_recorded', 'money_changed',
        'inbox_changed', 'tool_group_changed', 'video_changed', 'browser_changed', 'contacts_changed', 'contact_item',
        'line_changed', 'line_text', 'line_thinking', 'line_tool', 'line_message', 'line_queue',
        'web_tabs_changed', 'bookmarks_changed', 'space_changed', 'notify', 'notify_kinds_changed',
        'transcriber_changed',
      ].sort(),
    );
    source.open();
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('Remote project invalidation carries project ID without guessing from other events', () => {
    const { source, events } = connect();
    source.emit('project_invalidated', { type: 'project_invalidated', projectId: 'project-one' }, 'project-1');
    expect(events).toEqual([{ type: 'project.invalidated', projectId: 'project-one' }]);
  });

  it('Space invalidation carries space ID and maps to reload active reader', () => {
    const { source, events } = connect();
    source.emit('space_changed', { type: 'space_changed', spaceId: 'space-example' }, 'sp-1');
    expect(events).toEqual([{ type: 'space.changed', spaceId: 'space-example' }]);
  });

  it('Remote bookmark edit maps to bookmarks.changed so bookmark list reloads', () => {
    const { source, events } = connect();
    source.emit('bookmarks_changed', { type: 'bookmarks_changed' }, 'bm-1');
    expect(events).toEqual([{ type: 'bookmarks.changed' }]);
  });

  it('Browser auto-reconnect emits connecting; CLOSED emits closed and checks session', async () => {
    const { source, sources, statuses, calls, unauthorized } = connect(json(401, UNAUTHORIZED));
    source.open();
    source.fail(false);
    expect(statuses.at(-1)).toBe('connecting');
    expect(source.closed).toBe(false);
    source.fail(true);
    expect(statuses.at(-1)).toBe('closed');
    expect(source.closed).toBe(true);
    expect(sources.created).toHaveLength(1);
    await vi.waitFor(() => expect(unauthorized).toHaveBeenCalledTimes(1));
    expect(calls[0]?.url).toBe('/v2/session');
  });

  it('Resubscribe after close passes ?lastEventId=; ready without id keeps last id', () => {
    const { http, source, sources } = connect(json(200, {}));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    push(source, { type: 'note_invalidated', noteId: 'note_1' }, 'ab12cd34-7');
    push(source, { type: 'ready', resync: false });
    source.fail(true);
    http.events.subscribe({ onEvent: () => undefined, onStatus: () => undefined });
    expect(sources.created[1]?.url).toBe('/v2/events?lastEventId=ab12cd34-7');
  });

  it('Unsubscribe closes EventSource and stops dispatching further events', () => {
    const { source, events, unsubscribe, statuses } = connect();
    unsubscribe();
    push(source, { type: 'ask_created', ask: askView(), current: true });
    expect(source.closed).toBe(true);
    expect(events).toEqual([]);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('EventsHub on real stream resubscribes with backoff after browser closes', async () => {
    vi.useFakeTimers();
    const sources = eventSources();
    const { fetch } = fakeFetch(() => json(200, {}));
    const hub = new EventsHub(createHttpApi({ fetch, createEventSource: sources.create }).events);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    hub.start();
    sources.created[0]?.open();
    expect(hub.status.get()).toBe('open');
    sources.created[0]?.fail(true);
    expect(hub.status.get()).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources.created).toHaveLength(2);
    hub.stop();
    vi.useRealTimers();
  });
});

describe('Real event stream - resume from disconnect', () => {
  it('Initial ready carries start id for resume; no id yet means cannot resume', () => {
    const { http, source, sources } = connect(json(200, {}));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(http.events.resumable()).toBe(false);
    push(source, { type: 'ready', resync: false }, 'ab12cd34-0');
    expect(http.events.resumable()).toBe(true);
    source.fail(true);
    http.events.subscribe({ onEvent: () => undefined, onStatus: () => undefined });
    expect(sources.created[1]?.url).toBe('/v2/events?lastEventId=ab12cd34-0');
  });

  it('EventsHub emits resync after non-resumable reconnect without prior id', async () => {
    vi.useFakeTimers();
    const sources = eventSources();
    const { fetch } = fakeFetch(() => json(200, {}));
    const hub = new EventsHub(createHttpApi({ fetch, createEventSource: sources.create }).events);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: LiveEvent[] = [];
    hub.on((event) => events.push(event));
    hub.start();
    sources.created[0]?.open();
    sources.created[0]?.fail(true);
    await vi.advanceTimersByTimeAsync(1000);
    sources.created[1]?.open();
    expect(events).toEqual([{ type: 'resync' }]);
    hub.stop();
  });

  it('EventsHub skips extra resync on id-resumed reconnect since server replays/resyncs', async () => {
    vi.useFakeTimers();
    const sources = eventSources();
    const { fetch } = fakeFetch(() => json(200, {}));
    const hub = new EventsHub(createHttpApi({ fetch, createEventSource: sources.create }).events);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events: LiveEvent[] = [];
    hub.on((event) => events.push(event));
    hub.start();
    sources.created[0]?.open();
    sources.created[0]?.emit('ready', { type: 'ready', resync: false }, 'ab12cd34-0');
    sources.created[0]?.fail(true);
    await vi.advanceTimersByTimeAsync(1000);
    sources.created[1]?.open();
    expect(events).toEqual([]);
    expect(sources.created[1]?.url).toBe('/v2/events?lastEventId=ab12cd34-0');
    hub.stop();
  });
});

describe('Real event stream - new kernel lines', () => {
  it('line_* events validate via LineStreamEventSchema to { type: line } else resync', () => {
    const { source, events } = connect();
    source.emit('line_text', { type: 'line_text', lineId: 'line-main', delta: '你好' }, '7');
    source.emit('line_queue', { type: 'line_queue', lineId: 'line-main' }, '8');
    expect(events).toEqual([
      { type: 'line', event: { type: 'line_text', lineId: 'line-main', delta: '你好' } },
      { type: 'resync' },
    ]);
  });
});

describe('Real event stream - card events', () => {
  it('Maps ask_created, ask_answered, and ask_updated verbatim to ask.*', () => {
    const { source, events } = connect();
    const ask = askView();
    source.emit('ask_created', { type: 'ask_created', ask, current: true });
    source.emit('ask_answered', { type: 'ask_answered', ask: { ...ask, status: 'answered', version: 2 } });
    source.emit('ask_updated', { type: 'ask_updated', ask: { ...ask, status: 'withdrawn', version: 3 } });
    expect(events.map((event) => event.type)).toEqual(['ask.created', 'ask.answered', 'ask.updated']);
    expect(events[0]).toEqual({ type: 'ask.created', ask, current: true });
  });

  it('Schema-invalid card event (missing fields) triggers resync without guessing', () => {
    const { source, events } = connect();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    source.emit('ask_created', { type: 'ask_created', ask: { id: 'a1' }, current: true });
    expect(events).toEqual([{ type: 'resync' }]);
  });
});

describe('Real event stream - ready and unknown events', () => {
  it('ready{resync:true} emits resync to reload; ready{resync:false} emits nothing', () => {
    const { source, events } = connect();
    push(source, { type: 'ready', resync: false });
    expect(events).toEqual([]);
    push(source, { type: 'ready', resync: true });
    expect(events).toEqual([{ type: 'resync' }]);
  });

  it('Unknown/invalid event triggers resync without guessing, throttled to 1/min', () => {
    const { source, events } = connect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    source.emit('memory_entry_changed', { type: 'memory_entry_changed', entry: { id: 'x' } });
    source.emit('attachment_changed', 'not json');
    expect(events).toEqual([{ type: 'resync' }]);
    clock += 61_000;
    source.emit('ready', { type: 'attachment_changed', attachment: null });
    expect(events).toEqual([{ type: 'resync' }, { type: 'resync' }]);
    expect(warn).toHaveBeenCalled();
    expect(reloads).toEqual([]);
  });

  it('Strips extra fields from newer server (e.g. handedOff) without triggering resync', () => {
    const { source, events } = connect();
    source.emit('line_text', { type: 'line_text', lineId: 'line-main', delta: '你好', extra: 1 }, '7');
    expect(events).toEqual([{ type: 'line', event: { type: 'line_text', lineId: 'line-main', delta: '你好' } }]);
  });

  it('Repeated unknown events after resync reload full page (stale client), max 1/10m', () => {
    const { source, events } = connect();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let index = 0; index < 6; index += 1) {
      source.emit('line_queue', { type: 'line_queue', lineId: 'line-main' }, String(index));
      clock += 1_000;
    }
    expect(events).toEqual([{ type: 'resync' }]);
    expect(reloads).toEqual([1_002_000]);
  });
});
