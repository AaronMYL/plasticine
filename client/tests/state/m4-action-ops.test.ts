// M4 的写操作（信息流）存进 sessionStorage 后刷新还读得回来（请求体过 shared 的 schema）；没了结时再点，发的还是存下的那一份。

import { describe, expect, it } from 'vitest';
import { uncertainError } from '../../src/api/errors.ts';
import { ActionOps, requestIdOf, type ActionRequest } from '../../src/state/action-ops.ts';
import { feedItemOpKey } from '../../src/state/m4-action-requests.ts';
import { memoryStorage } from '../helpers.tsx';

describe('M4 写操作的标识', () => {
  it('评论待核实：刷新后读回同一个请求体；再点（这次写了另一句）发的还是第一次那句', () => {
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

  it('信息流的反应：被明确拒了之后再点，换新标识、按这次的输入发', () => {
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
