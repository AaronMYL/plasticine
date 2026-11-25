import assert from 'node:assert/strict';
import { test } from 'node:test';

test('runs tests in Asia/Shanghai timezone', () => {
  assert.equal(new Date('2026-10-27T00:00:00+08:00').getDate(), 27);
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -480);
});
