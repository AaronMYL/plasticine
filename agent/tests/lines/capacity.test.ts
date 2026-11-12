// 同时做几件事（11-12 全量优化第 2 条）：自动按机器算；设置里选了数就按选的。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLimit, BACKGROUND_LIMIT_KEY, effectiveLimit, readWorkLimit } from '../../src/lines/capacity.ts';

const calm = { load1: 0, freeRatio: 0.5 };

test('自动：核数 + 1，最少 2 最多 6', () => {
  assert.deepEqual([1, 2, 4, 8, 32].map((cores) => autoLimit({ cores, ...calm })), [2, 3, 5, 6, 6]);
});

test('自动：机器忙或内存不宽裕减半，很忙或内存快没了只留一条', () => {
  assert.equal(autoLimit({ cores: 4, load1: 4.5, freeRatio: 0.5 }), 2);
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.12 }), 2);
  assert.equal(autoLimit({ cores: 4, load1: 7, freeRatio: 0.5 }), 1);
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.05 }), 1);
  // Windows 上没有负载数（0）：只看内存。
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.9 }), 5);
});

test('设置：没存过或存坏了是自动；选了数就是那个数，不看机器', () => {
  const store = new Map<string, unknown>();
  const state = { kernelSettings: { get: (key: string) => store.get(key) } };
  assert.equal(readWorkLimit(state), 'auto');
  for (const bad of [0, 9, 2.5, '3', null]) {
    store.set(BACKGROUND_LIMIT_KEY, bad);
    assert.equal(readWorkLimit(state), 'auto');
  }
  store.set(BACKGROUND_LIMIT_KEY, 5);
  assert.equal(readWorkLimit(state), 5);
  assert.equal(effectiveLimit(5, { cores: 1, load1: 9, freeRatio: 0.01 }), 5);
  assert.equal(effectiveLimit('auto', { cores: 2, ...calm }), 3);
});
