import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedCommentGenerator } from '../../src/brain/feed-comments.ts';
import { scriptedText } from './helpers.ts';

test('信息流评论保留上下文；坏回复留下具体原因', async () => {
  const fake = scriptedText(['{"text":"接着这条评论。","level":null}', '格式坏了']);
  const reply = createFeedCommentGenerator(fake.models);
  const input = { item: { title: '隔离条目', summary: '摘要', url: null },
    source: { label: '关注点', interest: true, level: 'normal' },
    previous: [{ author: 'ai' as const, text: '上一句' }], text: '接上讨论' };
  assert.deepEqual(await reply(input, AbortSignal.timeout(1000)), { text: '接着这条评论。', level: null });
  assert.ok(JSON.stringify(fake.requests[0]?.messages).includes('上一句'));
  await assert.rejects(reply(input, AbortSignal.timeout(1000)), /JSON/);
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[0]?.purpose, 'feed_comment');
});
