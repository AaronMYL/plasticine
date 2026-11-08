// 壳这一头的助手调用（第 14 条）：按 id 对回执、半行拼起来、取消和超时会让助手 cancel、助手退出全部交回。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HelperCallError, HelperClient } from '../../shared/desktop-helper-client.ts';

function harness() {
  const sent: Record<string, unknown>[] = [];
  const client = new HelperClient((line) => {
    assert.ok(line.endsWith('\n') && !line.slice(0, -1).includes('\n'), '一次写一行');
    sent.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { client, sent };
}

const EVENTS = { events: [], truncated: false };

test('回执按 id 交回，顺序不要紧；半行等下一块拼起来', async () => {
  const { client, sent } = harness();
  const first = client.call('calendar.events', { from: '2026-11-08T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' });
  const second = client.call('permissions.status', {});
  assert.deepEqual(sent.map((request) => request['method']), ['calendar.events', 'permissions.status']);
  const status = JSON.stringify({ id: sent[1]?.['id'], result: { screen: true, accessibility: false,
    calendar: 'granted', reminders: 'denied' } });
  client.receive(`${status}\n{"id":"${String(sent[0]?.['id'])}",`);
  client.receive(`"result":${JSON.stringify(EVENTS)}}\n`);
  assert.deepEqual(await first, EVENTS);
  assert.equal((await second).reminders, 'denied');
  assert.equal(client.inFlight, 0);
});

test('助手回错误码：按 HelperCallError 交回', async () => {
  const { client, sent } = harness();
  const call = client.call('calendar.update', { eventId: 'e1', title: '改个名' });
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], error: { code: 'needs_confirmation', message: '先问他' } })}\n`);
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError
    && error.code === 'needs_confirmation' && error.message === '先问他');
});

test('回执形状不对按 failed，不当成功', async () => {
  const { client, sent } = harness();
  const call = client.call('screenshot', {});
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], result: { png: 'x' } })}\n`);
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError && error.code === 'failed');
});

test('参数不过 schema 不发给助手', async () => {
  const { client, sent } = harness();
  await assert.rejects(client.call('scroll', { dy: 999 }), (error: unknown) => error instanceof HelperCallError
    && error.code === 'invalid_params');
  assert.equal(sent.length, 0);
});

test('取消：交回 cancelled，并让助手 cancel 那一次；它迟到的回执丢掉', async () => {
  const { client, sent } = harness();
  const controller = new AbortController();
  const call = client.call('command.run', { command: 'sleep 100', cwd: '~' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError && error.code === 'cancelled');
  assert.equal(sent[1]?.['method'], 'cancel');
  assert.deepEqual(sent[1]?.['params'], { requestId: sent[0]?.['id'] });
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], error: { code: 'cancelled', message: '已取消' } })}\n`);
  client.receive(`${JSON.stringify({ id: sent[1]?.['id'], result: { cancelled: true } })}\n`);
  assert.equal(client.inFlight, 0);
});

test('超时：交回 timeout，并让助手 cancel', async () => {
  const { client, sent } = harness();
  await assert.rejects(client.call('screenshot', {}, { timeoutMs: 5 }),
    (error: unknown) => error instanceof HelperCallError && error.code === 'timeout');
  assert.equal(sent[1]?.['method'], 'cancel');
});

test('助手退出：在等的全部交回 closed，之后直接拒', async () => {
  const { client } = harness();
  const call = client.call('screenshot', {});
  client.close();
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError && error.code === 'closed');
  await assert.rejects(client.call('screenshot', {}), (error: unknown) => error instanceof HelperCallError
    && error.code === 'closed');
});

test('读不懂的行和 id 为 null 的错误不影响在等的调用', async () => {
  const { client, sent } = harness();
  const call = client.call('helper.info', {});
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    client.receive('不是 JSON\n{"id":null,"error":{"code":"invalid_request","message":"读不懂"}}\n');
  } finally {
    console.warn = warn;
  }
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], result: { name: 'plasticine-helper', version: '0.8.0',
    protocol: 1, methods: ['helper.info'] } })}\n`);
  assert.equal((await call).protocol, 1);
});
