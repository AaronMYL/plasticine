import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

function device(name = '手机'): string {
  return t.state.devices.create({ name, firstSeenAt: at(0), lastSeenAt: at(0) }).id;
}

function session(deviceId: string, token: string) {
  return t.state.sessions.create({ tokenHash: hash(token), deviceId, expiresAt: at(86_400_000), lastSeenAt: at(0) });
}

test('会话只存令牌散列，按散列找回', () => {
  const created = session(device(), 'token-1');
  assert.equal(t.state.sessions.findByTokenHash(hash('token-1'))?.id, created.id);
  assert.equal(t.state.sessions.findByTokenHash(hash('token-2')), undefined);
});

test('会话必须挂在登记过的设备上', () => {
  throwsState(() => session('没有这台', 'token-x'), 'invalid_input');
});

test('撤销设备时它所有没撤销的会话一起撤销，别的设备的不动', () => {
  const phone = device('手机');
  const laptop = device('电脑');
  session(phone, 'a');
  session(phone, 'b');
  const other = session(laptop, 'c');
  const revoked = t.state.sessions.revokeForDevice(phone, at(5000));
  assert.equal(revoked.length, 2);
  assert.ok(revoked.every((item) => item.revokedAt === at(5000)));
  assert.equal(t.state.sessions.get(other.id)?.revokedAt, null);
});

test('登出两次保留第一次的时间', () => {
  const created = session(device(), 'token-1');
  t.state.sessions.revoke(created.id, at(1000));
  assert.equal(t.state.sessions.revoke(created.id, at(2000)).revokedAt, at(1000));
});
