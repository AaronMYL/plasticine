import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventsHub } from '../../src/api/events-hub.ts';
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

function connect(...responses: Array<ReturnType<typeof json>>) {
  const sources = eventSources();
  const { fetch, calls } = fakeFetch(...responses.map((response) => () => response));
  const http = createHttpApi({ fetch, createEventSource: sources.create, now: () => NOW });
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

describe('真事件流 · 连接', () => {
  it('连 /v2/events，所有业务事件和线的事件都挂上监听；连上后报 open', () => {
    const { source, statuses } = connect();
    expect(source.url).toBe('/v2/events');
    expect(source.types).toEqual(
      [
        'ready', 'attachment_changed', 'money_draft_changed', 'client_version_changed', 'backups_changed', 'tasks_changed',
        'note_invalidated', 'project_invalidated', 'book_changed', 'ask_created', 'ask_answered', 'ask_updated',
        'memory_entry_changed', 'calendar_changed',
        'agreement_changed', 'feed_item_changed', 'node_changed', 'node_action_recorded', 'money_changed',
        'inbox_changed', 'tool_group_changed', 'video_changed', 'browser_changed', 'contacts_changed', 'contact_item',
        'line_changed', 'line_text', 'line_thinking', 'line_tool', 'line_message', 'line_queue',
        'web_tabs_changed', 'bookmarks_changed', 'space_changed', 'notify', 'notify_kinds_changed',
      ].sort(),
    );
    source.open();
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('项目的远端失效事件保留项目身份，页面不靠其他业务事件猜测更新', () => {
    const { source, events } = connect();
    source.emit('project_invalidated', { type: 'project_invalidated', projectId: 'project-one' }, 'project-1');
    expect(events).toEqual([{ type: 'project.invalidated', projectId: 'project-one' }]);
  });

  it('空间失效只携带空间身份，映射后让当前阅读器重读', () => {
    const { source, events } = connect();
    source.emit('space_changed', { type: 'space_changed', spaceId: 'space-example' }, 'sp-1');
    expect(events).toEqual([{ type: 'space.changed', spaceId: 'space-example' }]);
  });

  it('书签在别处改了（第 8 批第 1 条，各设备同一份）：映射成 bookmarks.changed，书签列表据此重读', () => {
    const { source, events } = connect();
    source.emit('bookmarks_changed', { type: 'bookmarks_changed' }, 'bm-1');
    expect(events).toEqual([{ type: 'bookmarks.changed' }]);
  });

  it('浏览器自己重连时报 connecting，不重新建连接；放弃了（CLOSED）才报 closed，并去查一次会话', async () => {
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

  it('放弃后重新订阅：用最后一条事件的 id 接上（?lastEventId=），ready 没有 id 不改它', () => {
    const { http, source, sources } = connect(json(200, {}));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    push(source, { type: 'note_invalidated', noteId: 'note_1' }, 'ab12cd34-7');
    push(source, { type: 'ready', resync: false });
    source.fail(true);
    http.events.subscribe({ onEvent: () => undefined, onStatus: () => undefined });
    expect(sources.created[1]?.url).toBe('/v2/events?lastEventId=ab12cd34-7');
  });

  it('取消订阅关掉 EventSource，之后到的事件不再分发', () => {
    const { source, events, unsubscribe, statuses } = connect();
    unsubscribe();
    push(source, { type: 'ask_created', ask: askView(), current: true });
    expect(source.closed).toBe(true);
    expect(events).toEqual([]);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('EventsHub 接真事件流：浏览器放弃后按退避重新订阅', async () => {
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

describe('真事件流 · 接上断开的位置', () => {
  it('第一条 ready 带着起点位置的 id：之后放弃再订阅，用它接上；还没拿到过 id 时不算接得上', () => {
    const { http, source, sources } = connect(json(200, {}));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(http.events.resumable()).toBe(false);
    push(source, { type: 'ready', resync: false }, 'ab12cd34-0');
    expect(http.events.resumable()).toBe(true);
    source.fail(true);
    http.events.subscribe({ onEvent: () => undefined, onStatus: () => undefined });
    expect(sources.created[1]?.url).toBe('/v2/events?lastEventId=ab12cd34-0');
  });

  it('EventsHub：接不上原来位置的重新订阅（没拿到过 id），连上之后补报一次 resync', async () => {
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

  it('EventsHub：带着 id 重新订阅的，服务端会补发或自己回 resync，这边不再多报', async () => {
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

describe('真事件流 · 新内核的线（2026-11-05）', () => {
  it('line_* 事件过 LineStreamEventSchema 后原样带成 { type: line }；不合 schema 的当作补不上了', () => {
    const { source, events } = connect();
    source.emit('line_text', { type: 'line_text', lineId: 'line-main', delta: '你好' }, '7');
    source.emit('line_queue', { type: 'line_queue', lineId: 'line-main' }, '8');
    expect(events).toEqual([
      { type: 'line', event: { type: 'line_text', lineId: 'line-main', delta: '你好' } },
      { type: 'resync' },
    ]);
  });
});

describe('真事件流 · 卡的事件', () => {
  it('ask_created / ask_answered / ask_updated 原样带成 ask.*', () => {
    const { source, events } = connect();
    const ask = askView();
    source.emit('ask_created', { type: 'ask_created', ask, current: true });
    source.emit('ask_answered', { type: 'ask_answered', ask: { ...ask, status: 'answered', version: 2 } });
    source.emit('ask_updated', { type: 'ask_updated', ask: { ...ask, status: 'withdrawn', version: 3 } });
    expect(events.map((event) => event.type)).toEqual(['ask.created', 'ask.answered', 'ask.updated']);
    expect(events[0]).toEqual({ type: 'ask.created', ask, current: true });
  });

  it('卡的事件不合 schema（少了字段）：不猜，当作补不上了', () => {
    const { source, events } = connect();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    source.emit('ask_created', { type: 'ask_created', ask: { id: 'a1' }, current: true });
    expect(events).toEqual([{ type: 'resync' }]);
  });
});

describe('真事件流 · ready 和认不出的事件', () => {
  it('ready{resync:true} → resync，重新拉第一页；ready{resync:false} 什么都不发', () => {
    const { source, events } = connect();
    push(source, { type: 'ready', resync: false });
    expect(events).toEqual([]);
    push(source, { type: 'ready', resync: true });
    expect(events).toEqual([{ type: 'resync' }]);
  });

  it('认不出的事件（不合 schema、不是 JSON、类型对不上）不猜，当作补不上了', () => {
    const { source, events } = connect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    source.emit('agreement_changed', { type: 'agreement_changed', agreement: { id: 'x' } });
    source.emit('attachment_changed', 'not json');
    source.emit('ready', { type: 'attachment_changed', attachment: null });
    expect(events).toEqual([{ type: 'resync' }, { type: 'resync' }, { type: 'resync' }]);
    expect(warn).toHaveBeenCalled();
  });
});
