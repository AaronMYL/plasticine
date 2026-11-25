import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpaceDoc } from '../../shared/state.ts';
import { summaryOf } from '../../src/subs/index.ts';

const DOC: SpaceDoc = { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }], blocks: [], sources: [] };

test('Legacy layout uses top feed sentence as headline, falling back to space title', () => {
  assert.deepEqual(summaryOf('研究周报', DOC), { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }] });
  const { headline: _headline, ...rest } = DOC;
  assert.equal(summaryOf('研究周报', rest).headline, '研究周报');
});
