import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { networkError } from '../../../src/api/errors.ts';
import { EventsHub } from '../../../src/api/events-hub.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { ActionOps } from '../../../src/state/action-ops.ts';
import { FeedUi } from '../../../src/state/feed-ui.ts';
import { InlineDrafts } from '../../../src/state/inline-drafts.ts';
import { FeedActions } from '../../../src/views/feed/feed-actions.ts';
import { FeedStore } from '../../../src/views/feed/feed-store.ts';
import { memoryStorage, NOW } from '../../helpers.tsx';

function setup() {
  const fake = createFakeApi({ seed: false, now: () => NOW, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const storage = memoryStorage();
  const mount = () => {
    const ui = new FeedUi();
    const store = new FeedStore(fake.api, new EventsHub(fake.api.events), ui);
    const ops = new ActionOps(storage);
    const actions = new FeedActions({ api: fake.api, store, ops, ui, drafts: new InlineDrafts(storage) });
    return { store, ops, actions };
  };
  let completed = false;
  const requests = new Set<string>();
  const post = vi.spyOn(fake.api.feed, 'refresh').mockImplementation(async ({ requestId }) => {
    requests.add(requestId);
    return { requestId, day: '2026-10-27', status: completed ? 'completed' : 'running',
      startedAt: NOW.toISOString(), finishedAt: completed ? NOW.toISOString() : null,
      added: completed ? 2 : 0, error: null };
  });
  return { fake, mount, post, requests, complete: () => { completed = true; } };
}

describe('寻找新内容的接续', () => {
  it('刷新已接受后查询断线，重载页面沿用原请求核实，不再启动一次搜集', async () => {
    const run = setup();
    vi.spyOn(run.fake.api.feed, 'refreshStatus').mockRejectedValueOnce(networkError('读刷新进度', '连接断开'));
    const first = run.mount();
    await first.actions.refresh();
    expect(first.ops.get('feed:refresh')?.status).toBe('uncertain');
    expect(first.store.refresh.state.get().error).toContain('连接断开');
    first.store.stop();
    run.complete();
    const next = run.mount();
    await next.actions.retry('feed:refresh');
    expect(run.post.mock.calls[0]?.[0].requestId).toBe(run.post.mock.calls[1]?.[0].requestId);
    expect(run.requests.size).toBe(1);
    expect(next.ops.get('feed:refresh')).toBeUndefined();
    expect(next.store.refresh.state.get().run).toMatchObject({ status: 'completed', added: 2 });
    next.store.stop();
  });

  it('关闭页面取消进度查询，保留服务端已接收的原请求供返回后核实', async () => {
    const run = setup();
    const first = run.mount();
    const pending = first.actions.refresh();
    await waitFor(() => expect(first.store.refresh.state.get().run?.status).toBe('running'));
    first.store.stop();
    await pending;
    expect(first.ops.get('feed:refresh')?.status).toBe('uncertain');
    expect(first.store.refresh.state.get().error).toContain('服务端已接收的刷新仍继续');
    run.complete();
    const next = run.mount();
    await next.actions.retry('feed:refresh');
    expect(run.requests.size).toBe(1);
    expect(next.store.refresh.state.get().run?.status).toBe('completed');
    next.store.stop();
  });
});
