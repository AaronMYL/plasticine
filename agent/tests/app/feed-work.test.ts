import assert from 'node:assert/strict';
import { TextModelError } from '../../src/kernel/index.ts';
import { test } from 'node:test';
import { call, json, pair, startTestApp } from './helpers.ts';
import type { FeedCommentsResponse } from '../../shared/api/feed-work.ts';

function reply(text: string, level: 'more' | 'less' | null = null) {
  return (JSON.stringify({ text, level }));
}

test('评论先保存再异步回复，重复请求不重复评论或调用；明确多推调整对应关注点', async () => {
  const t = await startTestApp([reply('可以继续留意它带来的实际变化。', 'more')], { startTasks: false });
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '效率工具', level: 'normal' });
    const item = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '工具新用途',
      day: '2026-10-27', arrivedAt: t.clock.now().toISOString(), dedupeKey: 'comment-example' }).item;
    const cookie = await pair(t);
    const path = `/v2/feed/items/${item.id}/comments`;
    const body = { requestId: 'comment-one', text: '这个关注点以后多推一点' };
    const sent = await call(t, 'POST', path, { cookie, body });
    assert.equal(sent.status, 201);
    const queued = sent.body as FeedCommentsResponse;
    assert.equal(queued.comments.length, 2);
    assert.equal(queued.comments[1]?.status, 'pending');
    await t.app.deps.daily.comments?.settled();
    assert.deepEqual((await call(t, 'POST', path, { cookie, body })).body, sent.body);
    const current = (await call(t, 'GET', path, { cookie })).body as FeedCommentsResponse;
    assert.equal(current.comments.length, 2);
    assert.match(current.comments[1]?.text ?? '', /已调为多推/);
    assert.equal(current.comments[1]?.status, 'completed');
    assert.equal(t.state.feedSources.require(source.id).level, 'more');
    assert.equal(t.requests.length, 1);
  } finally { await t.close(); }
});

test('回复失败保留原评论与原因，修正后只重试 AI 回复', async () => {
  const t = await startTestApp([new TextModelError('quota', '请求额度用完'),
    reply('这次先看对你实际有用的部分。', 'less')], { startTasks: false });
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '工具' });
    const item = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '一条内容',
      day: '2026-10-27', arrivedAt: t.clock.now().toISOString(), dedupeKey: 'comment-retry' }).item;
    const cookie = await pair(t);
    const path = `/v2/feed/items/${item.id}/comments`;
    await call(t, 'POST', path, { cookie, body: { requestId: 'comment-failed', text: '以后少推一点' } });
    await t.app.deps.daily.comments?.settled();
    const failed = t.app.deps.daily.comments!.list(item.id)[1]!;
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /额度/);
    const retry = `${path}/${encodeURIComponent(failed.id)}/retry`;
    const body = { requestId: 'comment-retry-ai' };
    await Promise.all([call(t, 'POST', retry, { cookie, body }), call(t, 'POST', retry, { cookie, body })]);
    await t.app.deps.daily.comments?.settled();
    const done = t.app.deps.daily.comments!.list(item.id);
    assert.equal(done.length, 2);
    assert.equal(done[1]?.status, 'completed');
    assert.equal(t.state.feedSources.require(source.id).level, 'less');
    assert.equal(t.requests.length, 2);
  } finally { await t.close(); }
});

test('旧评论从每份迁移原始档案读出，用户/AI 都保留、重复副本只显示一次、旧待回复不自动执行', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '迁入主题' });
    const comments = [{ id: 'old-u', by: 'user', text: '当时原话', at: '2026-10-20T01:00:00Z' },
      { id: 'old-a', by: 'ai', text: '当时回复', at: '2026-10-20T01:01:00Z' }];
    const item = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '旧条目',
      day: '2026-10-20', arrivedAt: '2026-10-20T00:00:00Z', dedupeKey: 'legacy-comment' },
    { migratedDefault: true, legacyPayload: { row: { comments } } }).item;
    t.state.legacyRows.record({ sourceDb: 'files', sourceTable: 'feed/saved.json', legacyId: 'old',
      targetTable: 'feed_items', targetId: item.id, reason: '隔离的旧收藏副本',
      payload: { row: { comments: [...comments, { id: 'old-p', by: 'ai', text: '',
        at: '2026-10-20T01:02:00Z', pending: true }] } } });
    const cookie = await pair(t);
    const response = await call(t, 'GET', `/v2/feed/items/${item.id}/comments`, { cookie });
    const rows = (response.body as FeedCommentsResponse).comments;
    assert.deepEqual(rows.map((row) => row.text), ['当时原话', '当时回复', '']);
    assert.ok(rows.every((row) => row.migrated));
    assert.equal(rows[2]?.status, 'failed');
    assert.equal(t.requests.length, 0);
  } finally { await t.close(); }
});

test('收藏不再是信息流里的筛选（第 110 条，收藏在书签页看）；关注点与探索方向一次建立；屏蔽恢复保留来源和旧条目',
  async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(t);
    const input = { requestId: 'interest-one', label: '软件方法', query: '软件工作流' };
    const created = await call(t, 'POST', '/v2/feed/sources', { cookie, body: input });
    assert.equal(created.status, 201);
    assert.deepEqual((await call(t, 'POST', '/v2/feed/sources', { cookie, body: input })).body, created.body);
    const source = json(created)['source'] as { id: string; concernId: string };
    assert.equal(source.concernId, `interest:${source.id}`);
    for (let index = 0; index < 4; index += 1) {
      const added = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: `条目${index}`,
        url: `https://example.test/a/${index}`,
        day: '2026-10-27', arrivedAt: t.clock.now().toISOString(), dedupeKey: `saved:${index}` }).item;
      if (index % 2) { t.state.feedItems.update(added.id, added.version, { savedAt: t.clock.now().toISOString() }); }
    }
    assert.equal((await call(t, 'GET', '/v2/feed?savedOnly=true&limit=1', { cookie })).status, 400);
    const result = json(await call(t, 'GET', '/v2/feed?limit=4', { cookie }));
    assert.deepEqual((result['items'] as { saved: boolean }[]).map((item) => item.saved).sort(),
      [false, false, true, true]);
    const block = { requestId: 'site-block', site: 'www.example.test', blocked: true };
    const blocked = json(await call(t, 'POST', '/v2/feed/sources/blocked', { cookie, body: block }))['source'] as
      { id: string; level: string };
    assert.equal(blocked.level, 'off');
    const restored = json(await call(t, 'POST', '/v2/feed/sources/blocked', { cookie,
      body: { ...block, requestId: 'site-restore', site: 'example.test', blocked: false } }))['source'] as
      { id: string; level: string };
    assert.equal(restored.id, blocked.id);
    assert.equal(restored.level, 'normal');
    assert.equal(t.state.feedItems.page({}, {}).length, 4);
  } finally { await t.close(); }
});

test('评论回复等待中用户改了档位，迟到回复不盖过用户的新选择', async () => {
  let finish: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const t = await startTestApp([async () => {
    await gate;
    return { text: reply('再看看后续。', 'more'), complete: true };
  }], { startTasks: false });
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '方法' });
    const item = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '实践',
      day: '2026-10-27', arrivedAt: t.clock.now().toISOString(), dedupeKey: 'concurrent' }).item;
    await call(t, 'POST', `/v2/feed/items/${item.id}/comments`, { cookie: await pair(t),
      body: { requestId: 'concurrent-comment', text: '多推' } });
    t.state.feedSources.update(source.id, source.version, { level: 'off' });
    finish?.();
    await t.app.deps.daily.comments?.settled();
    assert.equal(t.state.feedSources.require(source.id).level, 'off');
    assert.match(t.app.deps.daily.comments!.list(item.id)[1]?.text ?? '', /保留较新的档位/);
  } finally { finish?.(); await t.close(); }
});
