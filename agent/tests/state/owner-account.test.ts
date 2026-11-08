// 主人账号（迁移 0111，2026-11-08《首次使用流程》）：一份 Plasticine 只有一个主人。存名字、密码哈希和盐、设置时间、
// 一次性建账号令牌的哈希和过期时间；明文一样都不存。设备上的「本机」标记（迁移 0112）。

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

test('还没有主人：没有那一行，也没有密码', () => {
  assert.equal(t.state.ownerAccount.get(), undefined);
  assert.equal(t.state.ownerAccount.credentials(), null);
});

test('起名字、设密码：一行，密码只存哈希和盐，记下设置时间；再设一次换掉', () => {
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

test('建账号令牌：只存哈希；对的、没过期的能拿走一次，拿走就没了；过期的、错的拿不走', () => {
  t.state.ownerAccount.issueSetupToken(TOKEN_HASH, at(30 * 60_000));
  assert.equal(t.state.ownerAccount.takeSetupToken('f'.repeat(64), at(0)), false);
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(30 * 60_000)), false, '到点就过期');
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(1_000)), true);
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(2_000)), false, '只能用一次');
  t.state.ownerAccount.issueSetupToken(TOKEN_HASH, at(60_000));
  t.state.ownerAccount.issueSetupToken('1'.repeat(64), at(60_000));
  assert.equal(t.state.ownerAccount.takeSetupToken(TOKEN_HASH, at(1_000)), false, '再生成一个，旧的作废');
});

test('设备的本机标记：默认 false，登记时可以标成本机', () => {
  const plain = t.state.devices.create({ name: '手机', firstSeenAt: at(0), lastSeenAt: at(0) });
  assert.equal(plain.local, false);
  const local = t.state.devices.create({ name: '这台电脑', firstSeenAt: at(0), lastSeenAt: at(0), local: true });
  assert.equal(t.state.devices.get(local.id)?.local, true);
});
