import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import type { BrowserStreamEvent } from '../../shared/api/browser.ts';
import { CdpBrowser } from '../../src/cloud-tools/index.ts';
import { fakeCdp } from '../cloud-tools/fake-cdp.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

async function stream(app: TestApp, cookie: string, id: string) {
  const abort = new AbortController();
  const response = await fetch(`${app.base}/v2/browser/stream?streamId=${id}&width=390&height=800`, {
    headers: { cookie }, signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body?.getReader();
  assert.ok(reader);
  let buffer = '';
  const decoder = new TextDecoder();
  const events: BrowserStreamEvent[] = [];
  const reading = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const entry = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (entry.startsWith('data: ')) {
            events.push(JSON.parse(entry.slice(6)) as BrowserStreamEvent);
          }
          end = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        throw error;
      }
    }
  })();
  return { events, async close() {
    abort.abort();
    await reading;
  } };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) {
      return;
    }
    await pause(10);
  }
  assert.fail('没有收到预期的浏览器流事件');
}

test('画面只给当前会话，外会话不能 ACK；关闭观看和注销会停止录屏', async (t) => {
  const fake = await fakeCdp();
  const transport = new CdpBrowser({ endpoint: fake.endpoint });
  const app = await startTestApp([], { cloudTransports: { browser: transport } });
  t.after(async () => {
    await app.close();
    await fake.close();
  });
  const a = await pair(app, '设备甲');
  const b = await pair(app, '设备乙');
  const first = await stream(app, a, 'viewer-a');
  t.after(() => first.close());
  await until(() => fake.commands.some((c) => c.method === 'Page.startScreencast'));
  fake.frame(1);
  await until(() => first.events.some((e) => e.type === 'frame'));
  const frame = first.events.find((e) => e.type === 'frame');
  assert.ok(frame?.type === 'frame');
  const ack = { streamId: 'viewer-a', sequence: frame.frame.sequence };
  assert.equal(json(await call(app, 'POST', '/v2/browser/ack', { cookie: b, body: ack }))['ok'], false);
  fake.frame(2);
  await pause(30);
  assert.equal(first.events.filter((e) => e.type === 'frame').length, 1);
  assert.equal(json(await call(app, 'POST', '/v2/browser/ack', { cookie: a, body: ack }))['ok'], true);
  fake.frame(3);
  await until(() => first.events.filter((e) => e.type === 'frame').length === 2);
  const second = await stream(app, b, 'viewer-b');
  t.after(() => second.close());
  await until(() => first.events.some((e) => e.type === 'unavailable'));
  await until(() => fake.commands.filter((c) => c.method === 'Page.startScreencast').length === 2);
  fake.frame(4);
  await until(() => second.events.some((e) => e.type === 'frame'));
  assert.equal(first.events.filter((e) => e.type === 'frame').length, 2);
  await call(app, 'DELETE', '/v2/session', { cookie: b });
  await until(() => fake.commands.filter((c) => c.method === 'Page.stopScreencast').length >= 2);
  const count = second.events.filter((e) => e.type === 'frame').length;
  fake.frame(5);
  await pause(20);
  assert.equal(second.events.filter((e) => e.type === 'frame').length, count);
});

test('开始连接时就关闭页面，不留下录屏或事件订阅', async (t) => {
  const fake = await fakeCdp();
  const transport = new CdpBrowser({ endpoint: fake.endpoint });
  const app = await startTestApp([], { cloudTransports: { browser: transport } });
  t.after(async () => {
    await app.close();
    await fake.close();
  });
  const cookie = await pair(app);
  fake.hold('Page.startScreencast');
  const first = await stream(app, cookie, 'viewer-closed');
  await until(() => fake.commands.some((c) => c.method === 'Page.startScreencast'));
  await first.close();
  fake.hold(null);
  const next = await stream(app, cookie, 'viewer-next');
  t.after(() => next.close());
  await until(() => fake.commands.filter((c) => c.method === 'Page.startScreencast').length >= 2);
  fake.frame(7);
  await until(() => next.events.some((e) => e.type === 'frame'));
});
