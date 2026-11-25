import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoLimit, BACKGROUND_LIMIT_KEY, effectiveLimit, readWorkLimit } from '../../src/lines/capacity.ts';

const calm = { load1: 0, freeRatio: 0.5 };

test('auto concurrency equals cores + 1, clamped between 2 and 6', () => {
  assert.deepEqual([1, 2, 4, 8, 32].map((cores) => autoLimit({ cores, ...calm })), [2, 3, 5, 6, 6]);
});

test('auto concurrency halves under load/low memory and drops to 1 under heavy load/very low memory', () => {
  assert.equal(autoLimit({ cores: 4, load1: 4.5, freeRatio: 0.5 }), 2);
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.12 }), 2);
  assert.equal(autoLimit({ cores: 4, load1: 7, freeRatio: 0.5 }), 1);
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.05 }), 1);
  assert.equal(autoLimit({ cores: 4, load1: 0, freeRatio: 0.9 }), 5);
});

test('concurrency setting defaults auto on missing/corrupt; explicit number ignores host load', () => {
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
