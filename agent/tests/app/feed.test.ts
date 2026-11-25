import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { REPLAYED_HEADER, type FeedItemView } from '../../shared/api/index.ts';
import { compareFeedItems } from '../../shared/feed-order.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp, newRequestId } from './helpers.ts';
import { assertNoPrivateText, captureLogs, CREDENTIAL_PARAMS, PRIVATE_ERROR_TEXT } from '../safety-helpers.ts';
import { ARTICLE_URLS, unsafeUrl } from '../url-fixtures.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

function oldLinks(app: TestApp, table: string, id: string, fields: Record<string, string | null>): void {
  const db = new DatabaseSync(join(app.directory, 'plasticine.sqlite'));
  try {
    const assignments = Object.keys(fields).map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...Object.values(fields), id);
  } finally {
    db.close();
  }
}

test('manual feed item: 401 unauthenticated, 400 non-http(s) URL, stores URL verbatim', async () => {
  t = await startTestApp();
  const body = { requestId: newRequestId('add'), title: '一篇文章', url: 'javascript:alert(1)' };
  assert.equal((await call(t, 'POST', '/v2/feed/items', { body })).status, 401);
  const cookie = await pair(t);
  const refused = await call(t, 'POST', '/v2/feed/items', { cookie, body });
  assert.equal(refused.status, 400);
  assert.equal(json(refused)['field'], 'url');
  assert.doesNotMatch(JSON.stringify(refused.body), /pw@/);
  assert.deepEqual(t.state.feedItems.page({ includeHidden: true }, {}), []);
  const good = { requestId: newRequestId('add'), title: '一篇文章', url: 'https://example.com/a?id=1&token=abc' };
  const added = await call(t, 'POST', '/v2/feed/items', { cookie, body: good });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const item = json(added)['item'] as Body;
  assert.equal(item['url'], 'https://example.com/a?id=1&token=abc');
  assert.equal(item['originLabel'], '手动添加');
  assert.equal((await call(t, 'POST', '/v2/feed/items', { cookie, body: good })).headers.get(REPLAYED_HEADER), '1');
  assert.equal(t.state.feedItems.page({}, {}).length, 1);
});

test('owner URLs not sanitized: credentialed links stay verbatim in manual add, feed read, and SSE', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await openEvents(t, cookie);
  const raws = CREDENTIAL_PARAMS.map((name) => `https://user:pass@example.com/a?${name}=abc&page=2#token=abc`);
  try {
    for (const raw of raws) {
      const response = await call(t, 'POST', '/v2/feed/items', { cookie, body: {
        requestId: newRequestId('clean'), title: '合成文章', url: raw,
      } });
      assert.equal(response.status, 201);
      assert.equal((json(response)['item'] as Body)['url'], raw);
      const event = (await events.next('feed_item_changed')).event;
      assert.ok(event.type === 'feed_item_changed');
      assert.equal(event.item.url, raw);
    }
    const response = await call(t, 'GET', '/v2/feed', { cookie });
    assert.equal(response.status, 200);
    assert.deepEqual((json(response)['items'] as Body[]).map((item) => item['url']).sort(), [...raws].sort());
  } finally {
    events.close();
  }
});

test('legacy record URLs stay verbatim in read and SSE; invalid links hidden while row preserved', async (context) => {
  const logs = captureLogs(context);
  t = await startTestApp();
  const cookie = await pair(t);
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const urls = CREDENTIAL_PARAMS.map((name) => `https://user:pass@example.com/a?${name}=abc&page=2#token=abc`);
  const invalidUrl = `https://[${PRIVATE_ERROR_TEXT}`;
  urls.push(invalidUrl);
  const events = await openEvents(t, cookie);
  try {
    for (const [index, url] of urls.entries()) {
      const { item } = t.state.feedItems.add({
        sourceId: source.id, origin: 'manual', title: '旧条目',
        dedupeKey: `old-url-${index}`, day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z',
      });
      oldLinks(t, 'feed_items', item.id, { url, site: url });
      const response = await call(t, 'POST', `/v2/feed/items/${item.id}/save`, { cookie, body: {
        requestId: newRequestId('save'), version: 1, saved: true,
      } });
      assert.equal(response.status, 200);
      const expected = url === invalidUrl ? null : url;
      assert.equal((json(response)['item'] as Body)['url'], expected);
      const event = (await events.next('feed_item_changed')).event;
      assert.ok(event.type === 'feed_item_changed');
      assert.equal(event.item.url, expected);
      assert.equal(event.item.site, expected === null ? null : 'example.com');
      assert.equal(t.state.feedItems.require(item.id).url, url, '输出不改写旧记录');
    }
    const response = await call(t, 'GET', '/v2/feed', { cookie });
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(response.body), /私事|hunter2/);
    assertNoPrivateText(logs);
  } finally {
    events.close();
  }
});

test('legacy feed idempotent replay returns validated URL verbatim without re-executing', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const added = json(await call(t, 'POST', '/v2/feed/items', { cookie, body: {
    requestId: newRequestId('initial'), title: '旧条目', url: 'https://example.com/a?page=2',
  } }));
  const clean = added['item'] as Body;
  const id = String(clean['id']);
  for (const operation of ['add', 'save', 'reaction', 'conflict']) {
    const requestId = newRequestId('cached');
    const path = operation === 'add' ? '/v2/feed/items' : `/v2/feed/items/${id}/save`;
    const rawUrl = unsafeUrl();
    const dirty = { ...clean, url: rawUrl, site: rawUrl };
    const body = operation === 'conflict'
      ? { error: '记录已经改过。', code: 'version_conflict', current: dirty }
      : { item: dirty };
    const target = operation === 'reaction' ? `/v2/feed/items/${id}/reaction` : path;
    t.state.apiRequests.save({
      requestId, scope: `POST ${target}`, deviceId: null, body,
      status: operation === 'conflict' ? 409 : 200,
      createdAt: t.clock.now().toISOString(), expiresAt: '2026-10-28T08:00:00.000Z',
    });
    let request: Body = { requestId, version: 1, saved: true };
    if (operation === 'add') {
      request = { requestId, title: '旧条目', url: rawUrl };
    } else if (operation === 'reaction') {
      request = { requestId, version: 1, reaction: 'like' };
    }
    const replay = await call(t, 'POST', target, { cookie, body: request });
    assert.equal(replay.headers.get(REPLAYED_HEADER), '1');
    assert.equal(replay.status, operation === 'conflict' ? 409 : 200);
    const item = json(replay)[operation === 'conflict' ? 'current' : 'item'] as Body;
    assert.equal(item['url'], new URL(rawUrl).href);
    assert.equal(item['site'], 'example.com');
    assert.deepEqual(t.state.apiRequests.find(requestId)?.body, body, '历史缓存保持原样');
  }
  assert.equal(t.state.feedItems.require(id).version, 1);
});

test('recentSites groups by sanitized item URL, ignoring raw legacy site, bad URLs, and muted items', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const links = [unsafeUrl(), 'https://example.com/b', 'javascript:alert(1)', null, 'https://other.example/c'];
  for (const [index, url] of links.entries()) {
    const { item } = t.state.feedItems.add({
      sourceId: source.id, origin: 'manual', title: '旧条目', dedupeKey: `site-${index}`,
      day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z',
    });
    oldLinks(t, 'feed_items', item.id, { url, site: 'https://wrong.example/?token=abc' });
    if (index === 4) {
      t.state.feedItems.update(item.id, item.version, { reaction: 'dislike' });
    }
  }
  const response = await call(t, 'GET', '/v2/feed/sources', { cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(json(response)['recentSites'], [{ site: 'example.com', count: 2 }]);
  assert.doesNotMatch(JSON.stringify(response.body), /user:pass|token|next=|#|https/);
});

test('nested URL, long token, and JWT links stay verbatim across store, read, live SSE, and replay', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await openEvents(t, cookie);
  try {
    const cursor = t.app.deps.hub.cursor();
    const response = await call(t, 'POST', '/v2/feed/items', { cookie, body: {
      requestId: newRequestId('safe'), title: '文章', url: unsafeUrl(),
    } });
    assert.equal(response.status, 201);
    const raw = new URL(unsafeUrl()).href;
    const item = json(response)['item'] as Body;
    assert.equal(item['url'], raw);
    assert.equal(t.state.feedItems.require(String(item['id'])).url, raw);
    const event = (await events.next('feed_item_changed')).event;
    assert.ok(event.type === 'feed_item_changed');
    assert.equal(event.item.url, raw);
    t.app.deps.hub.publish({ type: 'feed_item_changed', item: {
      ...event.item, url: unsafeUrl(), site: unsafeUrl(), sourceLabel: unsafeUrl(),
    } });
    const replay = await openEvents(t, cookie, cursor);
    try {
      await replay.next('feed_item_changed');
      const old = (await replay.next('feed_item_changed')).event;
      assert.ok(old.type === 'feed_item_changed');
      assert.equal(old.item.url, raw);
      assert.equal(old.item.site, 'example.com');
      assert.equal(old.item.sourceLabel, unsafeUrl());
    } finally {
      replay.close();
    }
  } finally {
    events.close();
  }
});

test('source API, edit receipts, and conflict snapshots keep blocked sites host-only and queries raw', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const source = t.state.feedSources.create({ kind: 'blocked_site', label: 'example.com' });
  const raw = 'https://user:pass@example.com/a?page=2&next=https%3A%2F%2Fx.example%2F%3Ftoken%3Dabc#token=abc';
  oldLinks(t, 'feed_sources', source.id, { label: raw, query: raw });
  const response = json(await call(t, 'GET', '/v2/feed/sources', { cookie }));
  const view = (response['blocked'] as Body[])[0] ?? {};
  assert.equal(view['label'], 'example.com');
  assert.equal(view['query'], raw);
  for (const conflict of [false, true]) {
    const requestId = newRequestId('source-cache');
    const path = `/v2/feed/sources/${source.id}/level`;
      const { searchTerms: _newField, ...oldView } = view;
      const dirty = { ...oldView, label: raw, query: raw };
    t.state.apiRequests.save({
      requestId, scope: `POST ${path}`, deviceId: null,
      body: conflict ? { current: dirty } : { source: dirty }, status: conflict ? 409 : 200,
      createdAt: t.clock.now().toISOString(), expiresAt: '2026-10-28T08:00:00.000Z',
    });
    const replay = await call(t, 'POST', path, { cookie, body: { requestId, version: 1, level: 'off' } });
    assert.equal(replay.headers.get(REPLAYED_HEADER), '1');
    const cleaned = json(replay)[conflict ? 'current' : 'source'] as Body;
    assert.equal(cleaned['label'], 'example.com');
    assert.equal(cleaned['query'], raw);
      assert.deepEqual(cleaned['searchTerms'], []);
  }
  assert.equal(t.state.feedSources.require(source.id).version, 1);
});

test('plain article links stay verbatim across manual add, read, sources, cache, and SSE replay', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const events = await openEvents(t, cookie);
  try {
    for (const url of ARTICLE_URLS) {
      const cursor = t.app.deps.hub.cursor();
      const response = await call(t, 'POST', '/v2/feed/items', { cookie, body: {
        requestId: newRequestId('article'), title: '文章', url,
      } });
      assert.equal(response.status, 201);
      const item = json(response)['item'] as Body;
      assert.equal(item['url'], url);
      assert.equal(t.state.feedItems.require(String(item['id'])).url, url);
      const event = (await events.next('feed_item_changed')).event;
      assert.ok(event.type === 'feed_item_changed');
      assert.equal(event.item.url, url);
      const replay = await openEvents(t, cookie, cursor);
      try {
        const replayed = (await replay.next('feed_item_changed')).event;
        assert.ok(replayed.type === 'feed_item_changed');
        assert.equal(replayed.item.url, url);
      } finally {
        replay.close();
      }
      const requestId = newRequestId('article-cache');
      const path = `/v2/feed/items/${String(item['id'])}/save`;
      const dirty = { ...item, url: `${url}&next=https%3A%2F%2Fx.example%2F%3Ftoken%3Dabc`, site: url };
      t.state.apiRequests.save({
        requestId, scope: `POST ${path}`, deviceId: null, body: { item: dirty }, status: 200,
        createdAt: t.clock.now().toISOString(), expiresAt: '2026-10-28T08:00:00.000Z',
      });
      const cached = await call(t, 'POST', path, { cookie, body: { requestId, version: 1, saved: true } });
      assert.equal(cached.headers.get(REPLAYED_HEADER), '1');
      assert.equal((json(cached)['item'] as Body)['url'], dirty.url);
      const interest = await call(t, 'POST', '/v2/feed/sources', { cookie, body: {
        requestId: newRequestId('article-source'), label: '文章关注点', query: url,
      } });
      assert.equal(interest.status, 201);
      assert.equal((json(interest)['source'] as Body)['query'], url);
    }
    const items = json(await call(t, 'GET', '/v2/feed', { cookie }))['items'] as Body[];
    assert.deepEqual(items.map((item) => item['url']).sort(), [...ARTICLE_URLS].sort());
    const sources = json(await call(t, 'GET', '/v2/feed/sources', { cookie }))['interests'] as Body[];
    assert.deepEqual(sources.map((source) => source['query']).sort(), [...ARTICLE_URLS].sort());
  } finally {
    events.close();
  }
});

test('feed reactions: like, dismiss (hides), save; stale version 409; pushes feed_item_changed', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const added = json(await call(t, 'POST', '/v2/feed/items', {
    cookie,
    body: { requestId: newRequestId('add'), title: '一条' },
  }));
  const id = String((added['item'] as Body)['id']);
  const events = await openEvents(t, cookie);
  const liked = await call(t, 'POST', `/v2/feed/items/${id}/reaction`, {
    cookie,
    body: { requestId: newRequestId('re'), version: 1, reaction: 'like' },
  });
  assert.equal(((json(liked)['item'] as Body)['reaction']), 'like');
  const changed = await events.next('feed_item_changed');
  events.close();
  assert.ok(changed.event.type === 'feed_item_changed' && changed.event.item.reaction === 'like');
  const stale = await call(t, 'POST', `/v2/feed/items/${id}/save`, {
    cookie,
    body: { requestId: newRequestId('sv'), version: 1, saved: true },
  });
  assert.equal(stale.status, 409);
  assert.equal(json(stale)['currentVersion'], 2);
  const saved = await call(t, 'POST', `/v2/feed/items/${id}/save`, {
    cookie,
    body: { requestId: newRequestId('sv'), version: 2, saved: true },
  });
  assert.equal(((json(saved)['item'] as Body)['saved']), true);
  await call(t, 'POST', `/v2/feed/items/${id}/reaction`, {
    cookie,
    body: { requestId: newRequestId('re'), version: 3, reaction: 'dislike' },
  });
  assert.deepEqual(json(await call(t, 'GET', '/v2/feed', { cookie }))['items'], []);
  const hidden = json(await call(t, 'GET', '/v2/feed?includeHidden=true', { cookie }));
  assert.equal((hidden['items'] as Body[]).length, 1);
});

test('adding interest creates feed source with group key interest:<source>; disabling sets off', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const reply = await call(t, 'POST', '/v2/feed/sources', {
    cookie,
    body: { requestId: newRequestId('in'), label: 'AI agent' },
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const { source } = json(reply) as { source: Body };
  assert.equal(source['concernId'], `interest:${String(source['id'])}`);
  const sources = json(await call(t, 'GET', '/v2/feed/sources', { cookie }));
  assert.equal((sources['interests'] as Body[]).length, 1);
  const off = await call(t, 'POST', `/v2/feed/sources/${String(source['id'])}/level`, {
    cookie,
    body: { requestId: newRequestId('lv'), version: source['version'], level: 'off' },
  });
  assert.equal(((json(off)['source'] as Body)['level']), 'off');
});

test('feed daily grouping uses arrival time and request timezone, matching new-count badge', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  t.state.feedItems.add({
    sourceId: source.id,
    origin: 'manual',
    title: '半夜到的',
    dedupeKey: 'manual:late',
    day: '2026-10-27',
    arrivedAt: '2026-10-27T17:00:00.000Z',
  });
  const on28 = json(await call(t, 'GET', '/v2/feed?day=2026-10-28&tz=Asia/Shanghai', { cookie }));
  assert.equal((on28['items'] as Body[]).length, 1);
  const on27 = json(await call(t, 'GET', '/v2/feed?day=2026-10-27&tz=Asia/Shanghai', { cookie }));
  assert.equal((on27['items'] as Body[]).length, 0);
  const inUtc = json(await call(t, 'GET', '/v2/feed?day=2026-10-27&tz=UTC', { cookie }));
  assert.equal((inUtc['items'] as Body[]).length, 1);
});

test('invalid calendar date returns 400 pointing to day; leap day queries succeed', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  for (const day of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-00-01']) {
    const reply = await call(t, 'GET', '/v2/feed?day=' + day, { cookie });
    assert.equal(reply.status, 400);
    assert.equal(json(reply)['field'], 'day');
  }
  assert.equal((await call(t, 'GET', '/v2/feed?day=2024-02-29', { cookie })).status, 200);
});

test('feed shows external news only; legacy task/project rows stay in DB but excluded from feed views', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const concern = { id: 'interest:test' };
  const at = t.clock.now().toISOString();
  const day = at.slice(0, 10);
  const sources = {
    feed: t.state.feedSources.ensure({ ref: 'rss:outside', kind: 'rss', label: '站外订阅', query: 'https://a.example/' }),
    manual: t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' }),
    task: t.state.feedSources.ensure({ ref: 'internal:task', kind: 'internal', label: '任务' }),
    concern: t.state.feedSources.ensure({ ref: 'internal:concern', kind: 'internal', label: '项目' }),
  };
  for (const origin of ['feed', 'manual', 'task', 'concern'] as const) {
    t.state.feedItems.add({ sourceId: sources[origin].id, origin, title: `${origin} 条目`, concernId: concern.id,
      url: `https://${origin}.example/a`, dedupeKey: `origin:${origin}`, day, arrivedAt: at });
  }
  const feed = json(await call(t, 'GET', '/v2/feed?tz=UTC', { cookie }));
  assert.deepEqual((feed['items'] as Body[]).map((item) => item['origin']).sort(), ['feed', 'manual']);
  assert.equal(feed['newToday'], 2);
  const hidden = json(await call(t, 'GET', '/v2/feed?includeHidden=true&origin=task', { cookie }));
  assert.deepEqual(hidden['items'], []);
  const listed = json(await call(t, 'GET', '/v2/feed/sources', { cookie }));
  assert.deepEqual((listed['others'] as Body[]).map((source) => source['label']).sort(),
    ['X', '兴趣', '小红书', '手动添加', '站外订阅']);
  assert.deepEqual((listed['recentSites'] as Body[]).map((site) => site['site']).sort(),
    ['feed.example', 'manual.example']);
  const lead = t.state.feedItems.latestForConcern(concern.id);
  assert.ok(lead?.origin === 'feed' || lead?.origin === 'manual');
  assert.equal(t.state.feedItems.byDedupeKey('origin:task')?.origin, 'task', '旧行不删');
  assert.equal(t.app.deps.daily.scans.some((scan) => scan.name === '站内信息流'), false, '每日扫描里不再有站内收集');
});

test('saved filter (?saved=true) lists saved newest-first, drops unsaved, keeps dismissed hidden', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const ids: string[] = [];
  for (const title of ['早的收藏', '没收藏', '晚的收藏', '收藏了但不感兴趣']) {
    const added = json(await call(t, 'POST', '/v2/feed/items', { cookie,
      body: { requestId: newRequestId('add'), title } }));
    ids.push(String((added['item'] as Body)['id']));
  }
  const save = async (id: string, version: number, saved: boolean): Promise<Body> => {
    const reply = await call(t!, 'POST', `/v2/feed/items/${id}/save`, { cookie,
      body: { requestId: newRequestId('sv'), version, saved } });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    return json(reply)['item'] as Body;
  };
  for (const index of [0, 2, 3]) {
    await save(ids[index]!, 1, true);
  }
  await call(t, 'POST', `/v2/feed/items/${ids[3]!}/reaction`, { cookie,
    body: { requestId: newRequestId('re'), version: 2, reaction: 'dislike' } });
  const titles = async (query: string): Promise<unknown[]> =>
    (json(await call(t!, 'GET', `/v2/feed${query}`, { cookie }))['items'] as Body[]).map((item) => item['title']);
  assert.deepEqual(await titles('?saved=true'), ['晚的收藏', '早的收藏']);
  assert.deepEqual(await titles('?saved=true&includeHidden=true'), ['收藏了但不感兴趣', '晚的收藏', '早的收藏']);
  assert.deepEqual((await titles('')).length, 3, '不带筛选照旧列全部（不感兴趣的除外）');
  await save(ids[0]!, 2, false);
  assert.deepEqual(await titles('?saved=true'), ['晚的收藏']);
});

test('interest-matched items sort first within day then arrival; newer days stay first on paging', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const concern = { id: 'interest:agent' };
  const interest = t.state.feedSources.ensure({ ref: 'interest:agent', kind: 'interest', label: 'AI agent' });
  const outside = t.state.feedSources.ensure({ ref: 'rss:plain', kind: 'rss', label: '普通订阅',
    query: 'https://x.example/' });
  const rows = [
    { title: '昨天命中', day: '2026-10-26', at: '2026-10-26T02:00:00.000Z', hit: true },
    { title: '昨天普通', day: '2026-10-26', at: '2026-10-26T09:00:00.000Z', hit: false },
    { title: '今天命中（早）', day: '2026-10-27', at: '2026-10-27T01:00:00.000Z', hit: true },
    { title: '今天普通（晚）', day: '2026-10-27', at: '2026-10-27T09:00:00.000Z', hit: false },
    { title: '今天命中（晚）', day: '2026-10-27', at: '2026-10-27T05:00:00.000Z', hit: true },
  ];
  for (const row of rows) {
    t.state.feedItems.add({ sourceId: row.hit ? interest.id : outside.id, origin: 'feed', title: row.title,
      concernId: row.hit ? concern.id : null, dedupeKey: `rank:${row.title}`, day: row.day, arrivedAt: row.at });
  }
  const expected = ['今天命中（晚）', '今天命中（早）', '今天普通（晚）', '昨天命中', '昨天普通'];
  const all = json(await call(t, 'GET', '/v2/feed', { cookie }));
  const items = all['items'] as Body[];
  assert.deepEqual(items.map((item) => item['title']), expected);
  const paged: unknown[] = [];
  for (const offset of [0, 2, 4]) {
    const page = json(await call(t, 'GET', `/v2/feed?limit=2&offset=${offset}`, { cookie }));
    paged.push(...(page['items'] as Body[]).map((item) => item['title']));
  }
  assert.deepEqual(paged, expected, '翻页按同一个先后');
  const shuffled = [...items].reverse() as unknown as FeedItemView[];
  assert.deepEqual(shuffled.sort(compareFeedItems).map((item) => item.title), expected, '客户端排法和服务端一致');
  assert.deepEqual(t.state.feedItems.page({}, {}).map((item) => item.title)[0], '今天普通（晚）',
    '其他地方（回来时的汇总、关切线索）照旧按到达时间新的在前');
});

test('legacy Douyin borrowed save date no longer returned as published time; keeps arrival and source', async () => {
  const { feedItemView } = await import('../../src/app/daily-views.ts');
  t = await startTestApp();
  const source = t.state.feedSources.ensure({ kind: 'douyin', ref: 'douyin:favorites', label: '抖音收藏',
    level: 'normal' });
  const { item } = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '示例视频',
    url: 'https://www.douyin.com/video/7300000000000000100', dedupeKey: 'douyin-time-fixture', day: '2026-11-11',
    publishedAt: '2025-06-01T08:00:00.000Z', arrivedAt: '2026-11-11T04:00:00.000Z' });
  const view = feedItemView(t.state, item, null);
  assert.equal(view.publishedAt, null);
  assert.equal(view.arrivedAt, item.arrivedAt);
  assert.equal(view.sourceLabel, '抖音收藏');
});
