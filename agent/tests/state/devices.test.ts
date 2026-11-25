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

test('Registers device with name, first/last seen timestamps, and unrevoked state', () => {
  const device = t.state.devices.create({ name: 'Alex 的 iPhone', firstSeenAt: at(0), lastSeenAt: at(0) });
  assert.equal(device.name, 'Alex 的 iPhone');
  assert.equal(device.revokedAt, null);
  assert.equal(t.state.devices.get(device.id)?.firstSeenAt, at(0));
});

test('Updating device last-seen leaves first-seen timestamp unchanged', () => {
  const device = t.state.devices.create({ name: 'MacBook', firstSeenAt: at(0), lastSeenAt: at(0) });
  const touched = t.state.devices.touch(device.id, at(60_000));
  assert.equal(touched.lastSeenAt, at(60_000));
  assert.equal(touched.firstSeenAt, at(0));
});

test('Revoking device sets timestamp keeping row; re-revoking preserves first time', () => {
  const device = t.state.devices.create({ name: 'iPad', firstSeenAt: at(0), lastSeenAt: at(0) });
  t.state.devices.revoke(device.id, at(1000));
  const again = t.state.devices.revoke(device.id, at(2000));
  assert.equal(again.revokedAt, at(1000));
  assert.deepEqual(
    t.state.devices.list().map((item) => item.id),
    [device.id],
  );
});

test('Device list orders newly registered devices first', () => {
  const first = t.state.devices.create({ name: '一号', firstSeenAt: at(0), lastSeenAt: at(0) });
  const second = t.state.devices.create({ name: '二号', firstSeenAt: at(1), lastSeenAt: at(1) });
  assert.deepEqual(
    t.state.devices.list().map((item) => item.id),
    [second.id, first.id],
  );
});

test('Rejects empty device name or names exceeding 60 characters', () => {
  throwsState(() => t.state.devices.create({ name: '', firstSeenAt: at(0), lastSeenAt: at(0) }), 'invalid_input');
  const long = '机'.repeat(61);
  throwsState(() => t.state.devices.create({ name: long, firstSeenAt: at(0), lastSeenAt: at(0) }), 'invalid_input');
});
