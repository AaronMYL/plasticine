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

test('订阅后收到：主线上他说的话、线在跑、回答、线回到空闲', async () => {
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

test('登出后，这个会话开着的事件流立刻断开，不再收到之后的消息', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  assert.equal((await call(t, 'DELETE', '/v2/session', { cookie })).status, 200);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
});

test('撤销设备后，这台设备开着的事件流立刻断开', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  const devices = json(await call(t, 'GET', '/v2/devices', { cookie })) as { devices: { id: string }[] };
  const id = devices.devices[0]?.id ?? '';
  assert.equal((await call(t, 'DELETE', `/v2/devices/${id}`, { cookie })).status, 200);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
});

test('断线重连带 Last-Event-ID：补发断开期间的事件，不重复已经收到的', async () => {
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

test('Last-Event-ID 来自重启前（不认识的批次）：ready 带 resync，客户端要重新拉', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const stream = await subscribe(t, cookie, 'deadbeef-12');
  assert.deepEqual((await stream.next('ready')).event, { type: 'ready', resync: true });
});

test('第一次连上的 ready 带当前位置：还没收到别的事件就断了，重连也能补上断开期间的事件', async () => {
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

test('会话过期后，下一次心跳就断开事件流，再连是 401', async () => {
  t = await startTestApp([], { sseHeartbeatMs: 20 });
  const cookie = await pair(t);
  const events = await subscribe(t, cookie);
  await events.next('ready');
  t.clock.advance(401 * 24 * 60 * 60 * 1000);
  await assert.rejects(events.next(undefined, 2_000), /结束了/);
  assert.equal((await call(t, 'GET', '/v2/events', { cookie })).status, 401);
});

test('补播时超过待发上限就断开：断开之后不再起心跳、不往已结束的响应里写', async () => {
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
  // A client that reads nothing: after three writes everything else stays pending past the limit.
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

test('没有会话订阅 401', async () => {
  t = await startTestApp();
  const reply = await call(t, 'GET', '/v2/events');
  assert.equal(reply.status, 401);
  assert.equal(json(reply)['code'], 'unauthorized');
});
