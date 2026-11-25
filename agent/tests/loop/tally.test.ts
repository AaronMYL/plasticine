import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLD_RETRY_MS, keptRate, MIN_DECIDED, normalizeTopic, OFFER_STREAK, streak, temperature, type Tally }
  from '../../src/loop/tally.ts';

const tally = (kept: number, changed: number, rejected: number, last: string | null = null): Tally => ({
  topic: '排日程', kept, changed, rejected, decided: kept + changed + rejected, lastDecidedAt: last,
});

test('no records means even odds, and few records never change behaviour', () => {
  assert.equal(keptRate(tally(0, 0, 0)), 0.5);
  assert.equal(temperature(tally(0, 0, 0)), 'unknown');
  assert.equal(temperature(tally(0, 0, MIN_DECIDED - 1)), 'unknown');
});

test('enough records turn a topic warm or cold', () => {
  assert.equal(temperature(tally(MIN_DECIDED, 0, 0)), 'warm');
  assert.equal(temperature(tally(0, 1, MIN_DECIDED)), 'cold');
  assert.equal(temperature(tally(3, 0, 3)), 'mixed');
});

test('streak counts kept answers from the newest backwards and stops at the first other one', () => {
  assert.equal(streak(['kept', 'kept', 'changed', 'kept']), 2);
  assert.equal(streak(['rejected', 'kept']), 0);
  assert.equal(streak(Array.from({ length: OFFER_STREAK }, () => 'kept' as const)), OFFER_STREAK);
});

test('topics are trimmed, single-spaced and short so the same kind of work matches', () => {
  assert.equal(normalizeTopic('  排  日程 '), '排 日程');
  assert.equal(Array.from(normalizeTopic('一二三四五六七八九十一二三四五六七八') ?? '').length, 16);
  assert.equal(normalizeTopic('   '), null);
  assert.ok(COLD_RETRY_MS > 0);
});
