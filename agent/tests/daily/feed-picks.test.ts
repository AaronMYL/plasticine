import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedSelectionInput } from '../../shared/feed-selection.ts';
import { pickFeed } from '../../src/daily/feed-picks.ts';

function input(): FeedSelectionInput {
  return { candidates: Array.from({ length: 15 }, (_, i) => ({ id: `item-${i}`, sourceId: 'source',
    sourceLabel: '效率工具', title: `消息${i}`, text: `材料${i}`, url: `https://example.test/articles/${i}`,
    publishedAt: '2026-10-29T07:00:00Z', undated: false,
    via: '搜索', site: 'example.test', weight: 2 })),
  interests: [{ id: 'source', label: '效率工具', query: '效率工具' }, { id: 'finance', label: '金融', query: '政策' }],
  reactions: [] };
}

test('按内容选材重新归属，无关注点的丢掉，不为补数量放回无关报道', async () => {
  const material = input();
  const result = await pickFeed(material, async () => ({ items: [
    { id: 'item-0', sourceId: 'finance', summary: '政策性金融工具。', why: '金融关切。', event: '金融工具' },
    { id: 'item-1', sourceId: null, summary: '不属于任何关注点。', why: '无关。', event: '无关' },
  ] }), AbortSignal.timeout(1_000));
  assert.deepEqual(result.picks.map((pick) => [pick.id, pick.sourceId]), [['item-0', 'finance']]);
  assert.equal(result.error, null);
  const none = await pickFeed(material, async () => ({ items: [] }), AbortSignal.timeout(1_000));
  assert.equal(none.picks.length, 0);
});

test('重复事件只保留一条；模型失败和不合法归属留下具体错误，不假造内容判断', async () => {
  const material = input();
  const dedupe = await pickFeed(material, async () => ({ items: [0, 1, 1].map((i) => ({
    id: `item-${i}`, sourceId: 'source', summary: '同一事件的报道。', why: '相关。', event: '同一事件',
  })) }), AbortSignal.timeout(1_000));
  assert.equal(dedupe.picks.length, 1);
  const failed = await pickFeed(material, async () => { throw new Error('额度已经用完'); }, AbortSignal.timeout(1_000));
  assert.equal(failed.picks.length, 0);
  assert.match(failed.error ?? '', /额度已经用完/);
  const bad = await pickFeed(material, async () => ({ items: [{ id: 'item-0', sourceId: '不存在',
    summary: '摘要', why: '原因', event: '一' }] }), AbortSignal.timeout(1_000));
  assert.equal(bad.picks.length, 0);
  assert.match(bad.error ?? '', /关注点/);
});

test('独立订阅保留订阅来源；即使模型忽略信号，取消仍可退出', async () => {
  const material = input();
  material.candidates[0]!.via = '订阅：站点';
  const result = await pickFeed(material, async () => ({ items: [{ id: 'item-0', sourceId: null,
    summary: '订阅摘要', why: '你订阅的来源', event: '订阅' }] }), AbortSignal.timeout(1_000));
  assert.equal(result.picks.length, 1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try { await assert.rejects(pickFeed(material, async () => new Promise(() => {}), controller.signal)); }
  finally { clearTimeout(timer); }
});
