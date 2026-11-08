import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedCommentInput } from '../../shared/feed-comments.ts';
import { FeedComments } from '../../src/daily/feed-comments.ts';
import { openState } from '../../src/state/index.ts';

function setup() {
  const state = openState({ path: ':memory:' });
  const source = state.feedSources.create({ kind: 'interest', label: '隔离关注点' });
  const item = state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '隔离条目', day: '2026-10-31',
    arrivedAt: '2026-10-31T00:00:00Z', dedupeKey: 'comments-unit' }).item;
  return { state, item };
}

test('评论回复失败再遇通知失败，两份具体原因都留下，不冒充回复完成', async () => {
  const { state, item } = setup();
  const service = new FeedComments({ state, generate: async () => { throw new Error('模型请求额度已经用完'); },
    changed: () => { throw new Error('事件连接已经关闭'); } });
  try {
    state.feedComments.add(item.id, 'failed-twice', '原评论保留');
    service.resume();
    await service.settled();
    const rows = service.list(item.id);
    assert.equal(rows[0]?.text, '原评论保留');
    assert.equal(rows[1]?.status, 'failed');
    assert.match(rows[1]?.error ?? '', /模型请求额度已经用完/);
    assert.match(rows[1]?.error ?? '', /事件连接已经关闭/);
  } finally { await service.stop(); state.close(); }
});

test('连续评论逐条回复，各自上下文截止到当时那句，不把后发评论塞进前一条', async () => {
  const { state, item } = setup();
  const gate = Promise.withResolvers<void>();
  const inputs: FeedCommentInput[] = [];
  const service = new FeedComments({ state, changed: () => undefined, generate: async (input) => {
    inputs.push(input);
    if (inputs.length === 1) { await gate.promise; }
    return { text: `回复${input.text}`, level: null };
  } });
  try {
    state.feedComments.add(item.id, 'comment-one', '一');
    service.resume();
    state.feedComments.add(item.id, 'comment-two', '二');
    state.feedComments.add(item.id, 'comment-three', '三');
    gate.resolve();
    await service.settled();
    assert.deepEqual(inputs.map((input) => input.text), ['一', '二', '三']);
    assert.deepEqual(inputs[1]?.previous.map((row) => row.text), ['一', '回复一']);
    assert.deepEqual(inputs[2]?.previous.map((row) => row.text), ['一', '回复一', '二', '回复二']);
    assert.equal(service.list(item.id).length, 6);
  } finally { gate.resolve(); await service.stop(); state.close(); }
});
