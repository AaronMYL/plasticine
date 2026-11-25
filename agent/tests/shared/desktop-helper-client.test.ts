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

test('Helper receipts resolve by id out of order; partial lines buffer across chunks', async () => {
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

test('Helper error code rejects with HelperCallError', async () => {
  const { client, sent } = harness();
  const call = client.call('calendar.update', { eventId: 'e1', title: '改个名' });
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], error: { code: 'needs_confirmation', message: '先问他' } })}\n`);
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError
    && error.code === 'needs_confirmation' && error.message === '先问他');
});

test('Malformed receipt shape resolves as failed rather than succeeded', async () => {
  const { client, sent } = harness();
  const call = client.call('screenshot', {});
  client.receive(`${JSON.stringify({ id: sent[0]?.['id'], result: { png: 'x' } })}\n`);
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError && error.code === 'failed');
});

test('Parameters failing schema validation are not sent to helper', async () => {
  const { client, sent } = harness();
  await assert.rejects(client.call('scroll', { dy: 999 }), (error: unknown) => error instanceof HelperCallError
    && error.code === 'invalid_params');
  assert.equal(sent.length, 0);
});

test('Cancel returns cancelled, sends helper cancel, and drops late receipt', async () => {
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

test('Timeout returns timeout and sends cancel to helper', async () => {
  const { client, sent } = harness();
  await assert.rejects(client.call('screenshot', {}, { timeoutMs: 5 }),
    (error: unknown) => error instanceof HelperCallError && error.code === 'timeout');
  assert.equal(sent[1]?.['method'], 'cancel');
});

test('Helper exit resolves pending calls as closed and rejects subsequent calls', async () => {
  const { client } = harness();
  const call = client.call('screenshot', {});
  client.close();
  await assert.rejects(call, (error: unknown) => error instanceof HelperCallError && error.code === 'closed');
  await assert.rejects(client.call('screenshot', {}), (error: unknown) => error instanceof HelperCallError
    && error.code === 'closed');
});

test('Unparseable lines and null-id errors do not disrupt pending calls', async () => {
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
