// 旧版式空间（结构化文档）还没重写成网页时，那一句和几个数字照旧从文档里读。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpaceDoc } from '../../shared/state.ts';
import { summaryOf } from '../../src/subs/index.ts';

const DOC: SpaceDoc = { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }], blocks: [], sources: [] };

test('旧版式：信息流顶部那一句是结论大标题，没有就用空间标题', () => {
  assert.deepEqual(summaryOf('研究周报', DOC), { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }] });
  const { headline: _headline, ...rest } = DOC;
  assert.equal(summaryOf('研究周报', rest).headline, '研究周报');
});
