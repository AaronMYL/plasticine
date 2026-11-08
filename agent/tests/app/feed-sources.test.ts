// 第 7 批第 10、13 条：信息流来源都在第二栏管。加 Reddit 版块（先预览、取不到给原因）、每个来源一行带个数、只看一个
// 来源、设置里改排序、现在刷新、删掉（内置的不能删，删了的不再列，条目跟着拿掉）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import {
  FeedListResponseSchema,
  FeedNavResponseSchema,
  RedditPreviewResponseSchema,
  RefreshFeedSourceResponseSchema,
} from '../../shared/api/index.ts';
import { FeedFetcher } from '../../src/daily/index.ts';
import { call, json, pair, startTestApp, START_MS } from './helpers.ts';

function atom(subreddit: string, titles: readonly string[]): string {
  const entries = titles.map((title, index) => {
    const at = new Date(START_MS - (index + 1) * 3_600_000).toISOString();
    const url = `https://www.reddit.com/r/${subreddit}/comments/${index}abc/post_${index}/`;
    return `<entry><author><name>/u/poster_${index}</name></author><content type="html">&lt;p&gt;Body ${index}`
      + '&lt;/p&gt; submitted by &lt;a href="https://www.reddit.com/user/x"&gt; /u/poster_' + index
      + ` &lt;/a&gt;</content><link href="${url}" /><published>${at}</published><title>${title}</title></entry>`;
  }).join('');
  return `<feed xmlns="http://www.w3.org/2005/Atom"><title>${subreddit}</title>${entries}</feed>`;
}

test('Reddit 版块：预览最新三条、版块不在给原因；加上就取；第二栏一行带个数；改排序；只看这一个；删掉', async () => {
  const asked: string[] = [];
  const t = await startTestApp([], { feedFetcher: new FeedFetcher({ request: async (url) => {
    asked.push(url);
    if (url.includes('/r/nowhere/')) {
      return new Response('', { status: 404 });
    }
    return new Response(atom('neuroscience', ['One', 'Two', 'Three', 'Four']));
  } }) });
  try {
    const cookie = await pair(t);
    const preview = await call(t, 'GET', '/v2/feed/sources/reddit/preview?subreddit=r%2Fneuroscience&sort=hot',
      { cookie });
    assert.equal(preview.status, 200);
    assert.ok(Value.Check(RedditPreviewResponseSchema, preview.body));
    assert.equal(json(preview)['subreddit'], 'neuroscience');
    const posts = json(preview)['posts'] as { title: string; author: string }[];
    assert.deepEqual(posts.map((post) => post.title), ['One', 'Two', 'Three']);
    assert.equal(posts[0]?.author, 'u/poster_0');
    const missing = json(await call(t, 'GET', '/v2/feed/sources/reddit/preview?subreddit=nowhere&sort=new',
      { cookie }));
    assert.match(String(missing['error']), /404/);
    const bad = json(await call(t, 'GET', '/v2/feed/sources/reddit/preview?subreddit=%E4%B8%8D%E8%A1%8C&sort=hot',
      { cookie }));
    assert.equal(bad['subreddit'], null);

    const added = await call(t, 'POST', '/v2/feed/sources/reddit', { cookie,
      body: { requestId: 'reddit-add-0001', subreddit: 'r/neuroscience', sort: 'hot' } });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    await t.app.deps.daily.subscriptions.settled();
    const source = json(added)['source'] as { id: string; kind: string; label: string; version: number };
    assert.equal(source.kind, 'reddit');
    assert.equal(source.label, 'r/neuroscience');

    const nav = await call(t, 'GET', '/v2/feed/nav?tz=UTC', { cookie });
    assert.ok(Value.Check(FeedNavResponseSchema, nav.body));
    const rows = json(nav)['sources'] as { kind: string; label: string; count: number; source: { id: string } }[];
    const row = rows.find((entry) => entry.source.id === source.id);
    assert.equal(row?.kind, 'reddit');
    assert.equal(row?.count, 4);

    const only = await call(t, 'GET', `/v2/feed?sourceId=${source.id}`, { cookie });
    assert.ok(Value.Check(FeedListResponseSchema, only.body));
    const items = json(only)['items'] as { kind: string; author: { name: string } | null }[];
    assert.equal(items.length, 4);
    assert.ok(items.every((item) => item.kind === 'reddit'));
    assert.equal((json(await call(t, 'GET', '/v2/feed?kind=news', { cookie }))['items'] as unknown[]).length, 0);

    const sorted = await call(t, 'POST', `/v2/feed/sources/${source.id}/settings`, { cookie,
      body: { requestId: 'reddit-sort-0001', version: source.version, sort: 'top_week' } });
    assert.equal(sorted.status, 200, JSON.stringify(sorted.body));
    const changed = json(sorted)['source'] as { query: string; version: number };
    assert.equal(changed.query, 'https://www.reddit.com/r/neuroscience/top/.rss?t=week');
    await t.app.deps.daily.subscriptions.settled();
    assert.equal(asked.at(-1), 'https://www.reddit.com/r/neuroscience/top/.rss?t=week');

    const refreshed = await call(t, 'POST', `/v2/feed/sources/${source.id}/refresh`, { cookie,
      body: { requestId: 'reddit-refresh-01' } });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.ok(Value.Check(RefreshFeedSourceResponseSchema, refreshed.body));
    assert.equal(json(refreshed)['added'], 0);

    const x = rows.find((entry) => entry.kind === 'x');
    const builtIn = await call(t, 'POST', `/v2/feed/sources/${x?.source.id}/delete`, { cookie,
      body: { requestId: 'x-delete-00001', version: 1 } });
    assert.equal(builtIn.status, 400);
    const removed = await call(t, 'POST', `/v2/feed/sources/${source.id}/delete`, { cookie,
      body: { requestId: 'reddit-delete-01', version: changed.version } });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const after = json(await call(t, 'GET', '/v2/feed/nav?tz=UTC', { cookie }));
    assert.ok(!(after['sources'] as { source: { id: string } }[]).some((entry) => entry.source.id === source.id));
    assert.equal(after['all'], 0);
    assert.equal((json(await call(t, 'GET', '/v2/feed', { cookie }))['items'] as unknown[]).length, 0);
  } finally { await t.close(); }
});
