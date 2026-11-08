import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { DeviceKeyInput } from '../../shared/state.ts';
import { forged, openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const AT = '2026-10-27T08:00:00.000Z';

function deviceId(name = '测试手机'): string {
  return t.state.devices.create({ name, firstSeenAt: AT, lastSeenAt: AT }).id;
}

function keyInput(device: string, fill = 'A'): DeviceKeyInput {
  return {
    deviceId: device,
    publicKey: { kty: 'EC', crv: 'P-256', x: fill.repeat(43), y: 'B'.repeat(43) },
    thumbprint: fill === 'A' ? 'a'.repeat(64) : 'c'.repeat(64),
  };
}

test('登记设备钥匙：只存公钥的四个成员，按设备查得到现行的那把', () => {
  const device = deviceId();
  const key = t.state.deviceKeys.register(keyInput(device));
  assert.equal(key.deviceId, device);
  assert.equal(key.revokedAt, null);
  assert.deepEqual(Object.keys(key.publicKey).sort(), ['crv', 'kty', 'x', 'y']);
  assert.equal(t.state.deviceKeys.liveFor(device)?.id, key.id);
});

test('带私钥成员 d 的钥匙拒收，库里什么都不留', () => {
  const device = deviceId();
  const withPrivate = { ...keyInput(device), publicKey: { ...keyInput(device).publicKey, d: 'C'.repeat(43) } };
  throwsState(() => t.state.deviceKeys.register(forged(withPrivate)), 'invalid_input');
  assert.equal(t.state.deviceKeys.liveFor(device), undefined);
});

test('一台设备同时只有一把现行钥匙；同一把钥匙不能登记给两台设备', () => {
  const first = deviceId('手机');
  const second = deviceId('电脑');
  t.state.deviceKeys.register(keyInput(first));
  throwsState(() => t.state.deviceKeys.register(keyInput(first, 'D')), 'duplicate');
  throwsState(() => t.state.deviceKeys.register(keyInput(second)), 'duplicate');
});

test('设备撤销时它的钥匙一起撤；同一把钥匙之后可以登记给重新配对的设备', () => {
  const first = deviceId('手机');
  t.state.deviceKeys.register(keyInput(first));
  assert.equal(t.state.deviceKeys.revokeForDevice(first, AT)?.revokedAt, AT);
  assert.equal(t.state.deviceKeys.liveFor(first), undefined);
  const again = deviceId('同一台手机重新配对');
  assert.equal(t.state.deviceKeys.register(keyInput(again)).deviceId, again);
  assert.equal(t.state.deviceKeys.liveByThumbprint('a'.repeat(64))?.deviceId, again);
});

test('撤掉的钥匙不再是现行的，之后可以登记新的一把', () => {
  const device = deviceId();
  const key = t.state.deviceKeys.register(keyInput(device));
  t.state.deviceKeys.revoke(key.id, AT);
  assert.equal(t.state.deviceKeys.liveFor(device), undefined);
  const next = t.state.deviceKeys.register(keyInput(device, 'D'));
  assert.equal(t.state.deviceKeys.liveFor(device)?.id, next.id);
});
