// 测试进程的时区：不管机器在哪、命令前带没带 TZ，`npm test` 里都是上海时区。
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('测试跑在上海时区', () => {
  assert.equal(new Date('2026-10-27T00:00:00+08:00').getDate(), 27);
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -480);
});
