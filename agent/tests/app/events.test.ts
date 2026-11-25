import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, test } from 'node:test';
import { SSE_MAX_PENDING_BYTES } from '../../src/app/config.ts';
import { streamEvents } from '../../src/app/events.ts';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { call, json, openEvents, pair, startTestApp, type SseStream, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
const streams: SseStream[] = [];

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.close();
  }
  await t?.close();
  t = undefined;
});

async function subscribe(app: TestApp, cookie: string, lastEventId?: string): Promise<SseStream> {
  const stream = await openEvents(app, cookie, lastEventId);
  streams.push(stream);
  return stream;
}

const ANSWER = '现在 16:00。';
const SEND = '/v2/lines/line-main/messages';

async function idle(app: TestApp): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (app.state.lines.main().status !== 'idle' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isRole(frame: { event: { type: string } }, role: string): boolean {
  const event = frame.event as { type: string; message?: { role?: string } };
  return event.type === 'line_message' && event.message?.role === role;
}

test('SSE stream delivers user message, line running, reply, and line idle events', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  assert.deepEqual((await events.next('ready')).event, { type: 'ready', resync: false });
  t.respond([fauxAssistantMessage(ANSWER)]);
  await call(t, 'POST', SEND, { cookie, body: { requestId: 'req-00000001', text: '几点？' } });
  assert.ok(isRole(await events.next('line_message'), 'user'));
  const running = await events.next('line_changed');
  assert.ok(running.event.type === 'line_changed' && running.event.line.status === 'running');
  let reply = await events.next('line_message');
  while (!isRole(reply, 'assistant')) {
    reply = await events.next('line_message');
  }
  for (;;) {
    const changed = await events.next('line_changed');
    if (changed.event.type === 'line_changed' && changed.event.line.status === 'idle') {
      break;
    }
  }
});

test('logout immediately closes open event stream for that session with no further events', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  assert.equal((await call(t, 'DELETE', '/v2/session', { cookie })).status, 200);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
});

test('device revocation immediately closes open event streams for that device', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  const devices = json(await call(t, 'GET', '/v2/devices', { cookie })) as { devices: { id: string }[] };
  const id = devices.devices[0]?.id ?? '';
  assert.equal((await call(t, 'DELETE', `/v2/devices/${id}`, { cookie })).status, 200);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
});

test('reconnect with Last-Event-ID replays missed events without duplicating received ones', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const first = await subscribe(t, cookie);
  t.respond([fauxAssistantMessage(ANSWER)]);
  await call(t, 'POST', SEND, { cookie, body: { requestId: 'req-00000002', text: '几点？' } });
  const seen = await first.next('line_message');
  assert.ok(seen.id !== null && isRole(seen, 'user'));
  first.close();
  await idle(t);
  const again = await subscribe(t, cookie, seen.id);
  assert.deepEqual((await again.next('ready')).event, { type: 'ready', resync: false });
  let reply = await again.next('line_message');
  assert.equal(isRole(reply, 'user'), false, '已经收到的那条不重发');
  while (!isRole(reply, 'assistant')) {
    reply = await again.next('line_message');
  }
});

test('Last-Event-ID from before restart sends ready with resync flag for client refetch', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const stream = await subscribe(t, cookie, 'deadbeef-12');
  assert.deepEqual((await stream.next('ready')).event, { type: 'ready', resync: true });
});

test('initial ready event carries current cursor so early disconnect still replays missed events', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const first = await subscribe(t, cookie);
  const ready = await first.next('ready');
  assert.ok(ready.id !== null, 'ready 带 id，浏览器会记成 Last-Event-ID');
  first.close();
  t.respond([fauxAssistantMessage(ANSWER)]);
  await call(t, 'POST', SEND, { cookie, body: { requestId: 'req-00000009', text: '几点？' } });
  const again = await subscribe(t, cookie, ready.id ?? undefined);
  assert.deepEqual((await again.next('ready')).event, { type: 'ready', resync: false });
  assert.ok(isRole(await again.next('line_message'), 'user'));
});

test('expired session closes event stream on next heartbeat and returns 401 on reconnect', async () => {
  t = await startTestApp([], { sseHeartbeatMs: 20 });
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  t.clock.advance(401 * 24 * 60 * 60 * 1000);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
  assert.equal((await call(t, 'GET', '/v2/events', { cookie })).status, 401);
});

test('replay exceeding backlog cap closes stream without further heartbeats or writes', async () => {
  t = await startTestApp();
  const at = t.clock.now().toISOString();
  const device = t.state.devices.create({ name: '慢手机', firstSeenAt: at, lastSeenAt: at });
  const session = t.state.sessions.create({
    tokenHash: 'a'.repeat(64),
    deviceId: device.id,
    expiresAt: new Date(Date.parse(at) + 60_000).toISOString(),
    lastSeenAt: at,
  });
  const { hub } = t.app.deps;
  const from = hub.cursor();
  for (const noteId of ['n1', 'n2', 'n3']) {
    hub.publish({ type: 'note_invalidated', noteId });
  }
  const writes: string[] = [];
  let ends = 0;
  const res = {
    writeHead: () => res,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: () => {
      ends += 1;
    },
    get writableLength() {
      return writes.length >= 3 ? SSE_MAX_PENDING_BYTES + 1 : 0;
    },
  };
  const req = Object.assign(new EventEmitter(), { headers: {} });
  streamEvents({
    req: req as unknown as IncomingMessage,
    res: res as unknown as ServerResponse,
    url: new URL(`http://127.0.0.1/v2/events?lastEventId=${from}`),
    params: {},
    auth: { session, device },
    deps: { ...t.app.deps, sseHeartbeatMs: 5 },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ends, 1);
  const afterEnd = writes.length;
  assert.equal(writes.some((chunk) => chunk.startsWith(': ping')), false);
  assert.equal(afterEnd, 3);
  assert.equal(hub.subscriberCount, 0);
});

test('unauthenticated SSE subscription returns 401', async () => {
  t = await startTestApp();
  const reply = await call(t, 'GET', '/v2/events');
  assert.equal(reply.status, 401);
  assert.equal(json(reply)['code'], 'unauthorized');
});

test('space content revision and permanent delete broadcast only space identity for reader refresh', async () => {
  const { writeSpace } = await import('../../src/subs/index.ts');
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  const first = writeSpace(t.state, { title: '示例空间', genre: 'report',
    html: '<h1>这是一份用来检查实时更新的示例空间。</h1>' }, 'ai').space;
  assert.deepEqual((await events.next('space_changed')).event, { type: 'space_changed', spaceId: first.id });
  const next = writeSpace(t.state, { id: first.id, version: first.version, title: first.title,
    html: '<h1>这份空间已经更新，阅读端应当重新读它。</h1>' }, 'ai').space;
  assert.deepEqual((await events.next('space_changed')).event, { type: 'space_changed', spaceId: next.id });
  t.state.spaces.markDeleted(next.id, next.version);
  await events.next('space_changed');
  t.state.libraryPurge.space(next.id);
  assert.deepEqual((await events.next('space_changed')).event, { type: 'space_changed', spaceId: next.id });
});
