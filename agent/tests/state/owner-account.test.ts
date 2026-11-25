import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, START, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const at = (offsetMs: number): string => new Date(START + offsetMs).toISOString();
const FAKE_HASH = 'scrypt$16384$8$1$' + 'ab'.repeat(32);
const FAKE_SALT = 'cd'.repeat(16);
const TOKEN_HASH = 'e'.repeat(64);

test('Before setup there is no owner row and no password', () => {
  assert.equal(t.state.ownerAccount.get(), undefined);
  assert.equal(t.state.ownerAccount.credentials(), null);
});

test('Owner setup stores salted password hash and timestamp; resetting replaces it', () => {
  t.state.ownerAccount.setName('Alex');
  const set = t.state.ownerAccount.setPassword(FAKE_HASH, FAKE_SALT, at(0));
  assert.equal(set.displayName, 'Alex');
  assert.equal(set.passwordSetAt, at(0));
  assert.deepEqual(t.state.ownerAccount.credentials(), { hash: FAKE_HASH, salt: FAKE_SALT });
  const again = t.state.ownerAccount.setPassword(`${FAKE_HASH.slice(0, -2)}00`, FAKE_SALT, at(5_000));
  assert.equal(again.passwordSetAt, at(5_000));
  assert.equal(again.displayName, 'Alex');
  const row = t.state.ownerAccount.get();
  assert.equal(Object.values(row ?? {}).some((value) => value === FAKE_HASH), false, '视图里不带哈希');
});

test('Setup token stores hash only; valid unexpired claims once; invalid/expired fails', () => {
  t.state.ownerAccount.issueSetupToken(TOKEN_HASH, at(30 * 60_000));
  assert.equal(t.state.ownerAccount.takeSetupToken('f'.repeat(64), at(0)), false);
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(30 * 60_000)), false, '到点就过期');
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(1_000)), true);
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(2_000)), false, '只能用一次');
  t.state.ownerAccount.issueSetupToken(TOKEN_HASH, at(60_000));
  t.state.ownerAccount.issueSetupToken('1'.repeat(64), at(60_000));
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(1_000)), false, '再生成一个，旧的作废');
});

test('Device local flag defaults false and can be marked local at registration', () => {
  const plain = t.state.devices.create({ name: '手机', firstSeenAt: at(0), lastSeenAt: at(0) });
  assert.equal(plain.local, false);
  const local = t.state.devices.create({ name: '这台电脑', firstSeenAt: at(0), lastSeenAt: at(0), local: true });
  assert.equal(t.state.devices.get(local.id)?.local, true);
});
