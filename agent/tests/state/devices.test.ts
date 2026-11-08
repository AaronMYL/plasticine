import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, START, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const at = (offsetMs: number): string => new Date(START + offsetMs).toISOString();

test('登记一台设备：名字、首次时间、最后时间，没撤销', () => {
  const device = t.state.devices.create({ name: 'Alex 的 iPhone', firstSeenAt: at(0), lastSeenAt: at(0) });
  assert.equal(device.name, 'Alex 的 iPhone');
  assert.equal(device.revokedAt, null);
  assert.equal(t.state.devices.get(device.id)?.firstSeenAt, at(0));
});

test('更新最后时间不动首次时间', () => {
  const device = t.state.devices.create({ name: 'MacBook', firstSeenAt: at(0), lastSeenAt: at(0) });
  const touched = t.state.devices.touch(device.id, at(60_000));
  assert.equal(touched.lastSeenAt, at(60_000));
  assert.equal(touched.firstSeenAt, at(0));
});

test('撤销只打时间、行还在；再撤销一次保留第一次的时间', () => {
  const device = t.state.devices.create({ name: 'iPad', firstSeenAt: at(0), lastSeenAt: at(0) });
  t.state.devices.revoke(device.id, at(1000));
  const again = t.state.devices.revoke(device.id, at(2000));
  assert.equal(again.revokedAt, at(1000));
  assert.deepEqual(
    t.state.devices.list().map((item) => item.id),
    [device.id],
  );
});

test('列表新登记的在前', () => {
  const first = t.state.devices.create({ name: '一号', firstSeenAt: at(0), lastSeenAt: at(0) });
  const second = t.state.devices.create({ name: '二号', firstSeenAt: at(1), lastSeenAt: at(1) });
  assert.deepEqual(
    t.state.devices.list().map((item) => item.id),
    [second.id, first.id],
  );
});

test('设备名为空或超过 60 字拒绝', () => {
  throwsState(() => t.state.devices.create({ name: '', firstSeenAt: at(0), lastSeenAt: at(0) }), 'invalid_input');
  const long = '机'.repeat(61);
  throwsState(() => t.state.devices.create({ name: long, firstSeenAt: at(0), lastSeenAt: at(0) }), 'invalid_input');
});
