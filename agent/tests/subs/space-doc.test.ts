import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SpaceChart, SpaceDoc } from '../../shared/state.ts';
import { checkSpaceDoc, docFromMarkdown, SubsError, summaryOf } from '../../src/subs/index.ts';

function chart(extra: Partial<SpaceChart> = {}): SpaceChart {
  return { type: 'chart', kind: 'line', title: '重放次数与次日回忆', x: [0, 5, 10], unit: '%',
    series: [{ name: '回忆正确率', values: [41, 44, 43] }], caption: '每晚重放次数 → 次日回忆正确率',
    source: { label: '论文表 2（18 人）', url: 'https://example.org/paper' }, ...extra };
}

function doc(extra: Partial<SpaceDoc> = {}): SpaceDoc {
  return { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }],
    blocks: [{ type: 'heading', id: 'overview', text: '本周概览' }, { type: 'text', markdown: '重放越多，记得越好[^1]。' },
      chart()],
    sources: [{ label: 'Nature 2026', url: 'https://example.org/n' }], ...extra };
}

test('合规的正文原样通过：图表带数据和来源、[^n] 都有出处', () => {
  assert.deepEqual(checkSpaceDoc(doc()), doc());
});

test('图表每组数据的个数要和横轴一样多，不一样就拒绝（只能用存下来的数据画）', () => {
  assert.throws(() => checkSpaceDoc(doc({ blocks: [chart({ series: [{ name: 'a', values: [1, 2] }] })] })),
    (error) => error instanceof SubsError && /横轴/.test(error.message));
});

test('数字不是有限数（NaN、无穷）就拒绝', () => {
  assert.throws(() => checkSpaceDoc(doc({ blocks: [chart({ series: [{ name: 'a', values: [1, Infinity, 3] }] })] })),
    SubsError);
});

test('图表没写来源过不了 schema', () => {
  const { source: _source, ...rest } = chart();
  assert.throws(() => checkSpaceDoc(doc({ blocks: [rest as SpaceChart] })), SubsError);
});

test('图片要写来源', () => {
  const image = { type: 'image', url: 'https://example.org/a.png', alt: '示意图' };
  assert.throws(() => checkSpaceDoc(doc({ blocks: [image as never] })), SubsError);
});

test('正文里的 [^3] 没有第 3 条出处就拒绝', () => {
  assert.throws(() => checkSpaceDoc(doc({ blocks: [{ type: 'text', markdown: '没出处的说法[^3]' }] })),
    (error) => error instanceof SubsError && /\[\^3\]/.test(error.message));
});

test('小节锚点不能重复', () => {
  const heading = { type: 'heading', id: 'a', text: '一' } as const;
  assert.throws(() => checkSpaceDoc(doc({ blocks: [heading, { ...heading, text: '二' }] })), SubsError);
});

test('Markdown 按「## 小节」切成小节和正文，第一行的标题去掉', () => {
  const parsed = docFromMarkdown('悬赏规则草稿', '# 悬赏规则草稿\n\n开头一段。\n\n## 验收\n\n怎么验收。\n\n## 赏金\n\n从哪来。');
  assert.deepEqual(parsed.blocks.map((block) => block.type === 'heading' ? `#${block.text}` : block.type === 'text'
    ? block.markdown : block.type), ['开头一段。', '#验收', '怎么验收。', '#赏金', '从哪来。']);
  assert.deepEqual(parsed.stats, []);
});

test('摘要：结论大标题和数字卡；没有大标题用空间标题', () => {
  assert.deepEqual(summaryOf('研究周报', doc()), { headline: '本周最值得看的', stats: [{ value: '14', label: '篇读过' }] });
  const { headline: _headline, ...rest } = doc();
  assert.equal(summaryOf('研究周报', rest).headline, '研究周报');
});
