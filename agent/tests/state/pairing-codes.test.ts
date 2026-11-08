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

function device(): string {
  return t.state.devices.create({ name: '手机', firstSeenAt: at(0), lastSeenAt: at(0) }).id;
}

test('配对码只存散列，按散列找得到', () => {
  const code = t.state.pairingCodes.issue({ codeHash: hash('ABCD2345'), expiresAt: at(600_000) });
  assert.equal(t.state.pairingCodes.findByHash(hash('ABCD2345'))?.id, code.id);
  assert.equal(t.state.pairingCodes.findByHash(hash('ABCD2346')), undefined);
  assert.equal(code.usedAt, null);
});

test('不是散列的值存不进去', () => {
  throwsState(() => t.state.pairingCodes.issue({ codeHash: 'ABCD2345', expiresAt: at(1) }), 'invalid_input');
});

test('一个码只能记一次使用，第二次拒绝', () => {
  const code = t.state.pairingCodes.issue({ codeHash: hash('X'), expiresAt: at(600_000) });
  const deviceId = device();
  const used = t.state.pairingCodes.markUsed(code.id, { usedAt: at(1000), deviceId });
  assert.equal(used.usedAt, at(1000));
  assert.equal(used.deviceId, deviceId);
  throwsState(() => t.state.pairingCodes.markUsed(code.id, { usedAt: at(2000), deviceId }), 'duplicate');
});

test('同一个散列不能发两次', () => {
  t.state.pairingCodes.issue({ codeHash: hash('Y'), expiresAt: at(1) });
  throwsState(() => t.state.pairingCodes.issue({ codeHash: hash('Y'), expiresAt: at(2) }), 'duplicate');
});
