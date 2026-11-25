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

test('Sessions store token hash only and look up by hash', () => {
  const created = session(device(), 'token-1');
  assert.equal(t.state.sessions.findByTokenHash(hash('token-1'))?.id, created.id);
  assert.equal(t.state.sessions.findByTokenHash(hash('token-2')), undefined);
});

test('Session must belong to a registered device', () => {
  throwsState(() => session('没有这台', 'token-x'), 'invalid_input');
});

test('Revoking device revokes all its active sessions without affecting other devices', () => {
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

test('Logging out twice preserves the first logout timestamp', () => {
  const created = session(device(), 'token-1');
  t.state.sessions.revoke(created.id, at(1000));
  assert.equal(t.state.sessions.revoke(created.id, at(2000)).revokedAt, at(1000));
});
