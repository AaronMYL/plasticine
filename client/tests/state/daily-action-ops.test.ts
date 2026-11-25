import { describe, expect, it } from 'vitest';
import { uncertainError } from '../../src/api/errors.ts';
import { ActionOps, requestIdOf, type ActionRequest } from '../../src/state/action-ops.ts';
import { feedItemOpKey } from '../../src/state/daily-action-requests.ts';
import { memoryStorage } from '../helpers.tsx';

describe('M4 write action idempotency', () => {
  it('uncertain comment reloads saved body; re-clicking with new text still sends original', () => {
    const storage = memoryStorage();
    const ops = new ActionOps(storage);
    const key = 'feed:f1:comment';
    const comment = (text: string) => (requestId: string): ActionRequest => ({
      kind: 'feed_comment',
      itemId: 'f1',
      body: { requestId, text },
    });
    const first = ops.begin(key, '评论', '一条信息', comment('第一句'), () => 'req_first_0001');
    ops.fail(key, uncertainError('评论'));
    const reloaded = new ActionOps(storage);
    expect(reloaded.get(key)).toMatchObject({ status: 'uncertain', request: first, subject: '一条信息' });
    const again = reloaded.begin(key, '评论', '一条信息', comment('第二句'), () => 'req_second_001');
    expect(again).toEqual(first);
  });

  it('explicitly rejected feed reaction mints new ID and sends new input on retry', () => {
    const ops = new ActionOps(null);
    const key = feedItemOpKey('f1', 'react');
    const react = (requestId: string): ActionRequest => ({
      kind: 'feed_react',
      itemId: 'f1',
      body: { requestId, version: 1, reaction: 'like' },
    });
    ops.begin(key, '赞', '一篇', react, () => 'req_react_0001');
    ops.fail(key, new Error('这一条在别处改过了'));
    expect(ops.get(key)?.status).toBe('failed');
    const next = ops.begin(key, '赞', '一篇', react, () => 'req_react_0002');
    expect(requestIdOf(next)).toBe('req_react_0002');
  });
});
