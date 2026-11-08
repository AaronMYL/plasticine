import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttemptLimiter } from '../../src/app/attempt-limiter.ts';
import { generatePairingCode, normalizePairingCode, pairingCodeHash } from '../../src/app/pairing-code.ts';

test('配对码是两组四位，只用不易看错的字符', () => {
  for (let index = 0; index < 50; index += 1) {
    assert.match(generatePairingCode(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  }
});

test('规整：去空格和横线、转大写，O 读成 0、I 和 L 读成 1', () => {
  assert.equal(normalizePairingCode(' 7kq4-m2xd '), '7KQ4M2XD');
  assert.equal(normalizePairingCode('O1IL'), '0111');
  assert.equal(pairingCodeHash('7kq4 m2xd'), pairingCodeHash('7KQ4-M2XD'));
});

test('失败次数在窗口内到上限就挡住，窗口过了放开', () => {
  let now = 0;
  const limiter = new AttemptLimiter(2, 1000, () => now);
  limiter.recordFailure();
  assert.equal(limiter.blocked(), false);
  limiter.recordFailure();
  assert.equal(limiter.blocked(), true);
  assert.equal(limiter.retryAfterMs(), 1000);
  now = 1001;
  assert.equal(limiter.blocked(), false);
  assert.equal(limiter.retryAfterMs(), 0);
});
