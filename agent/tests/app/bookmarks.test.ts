// /v2/bookmarks（第 110 条）：加、去重、改名移项目、移除（行留着）、排序、导入；信息流收藏和书签分开（2026-11-04）；
// 没归项目的推一个项目；加了记进来源；⌘K 查得到名字和正文快照。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { STANDING_PROJECT_IDS } from '../../shared/state.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

async function start(options: Parameters<typeof startTestApp>[1] = {}): Promise<{ app: TestApp; cookie: string }> {
  t = await startTestApp([], options);
  return { app: t, cookie: await pair(t) };
}

async function add(app: TestApp, cookie: string, body: Body, status = 201): Promise<Body> {
  const reply = await call(app, 'POST', '/v2/bookmarks', { cookie, body: { requestId: newRequestId('bm'), ...body } });
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  return json(reply)['bookmark'] as Body;
}

async function list(app: TestApp, cookie: string): Promise<Body[]> {
  return json(await call(app, 'GET', '/v2/bookmarks', { cookie }))['bookmarks'] as Body[];
}

function feedItem(app: TestApp, overrides: { url?: string | null; concernId?: string | null } = {}): string {
  const source = app.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const { item } = app.state.feedItems.add({
    sourceId: source.id, origin: 'manual', title: '本地优先软件', url: overrides.url ?? 'https://example.com/lofi',
    summary: '数据先在自己的设备上，同步是锦上添花。', concernId: overrides.concernId ?? null,
    dedupeKey: `bm-${newRequestId('k')}`, day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z',
  });
  return item.id;
}

test('没登录 401；加网页书签 201，同一个网址再加回 200 和原来那一条，不重复', async () => {
  const { app, cookie } = await start();
  assert.equal((await call(app, 'GET', '/v2/bookmarks')).status, 401);
  const first = await add(app, cookie, { kind: 'web', title: 'Show HN 规则',
    target: 'https://news.ycombinator.com/showhn.html' });
  const again = await add(app, cookie, { kind: 'web', title: '换个名字',
    target: 'https://NEWS.ycombinator.com/showhn.html' }, 200);
  assert.equal(again['id'], first['id']);
  assert.equal(again['title'], 'Show HN 规则');
  assert.deepEqual((await list(app, cookie)).map((row) => row['title']), ['Show HN 规则']);
});

test('网页只收 http(s)：去掉账号密码和口令参数，# 后面留着，出口也不裁；页面要 #/ 地址', async () => {
  const { app, cookie } = await start();
  const web = await add(app, cookie, { kind: 'web', title: '单页应用',
    target: 'https://user:pass@app.example.com/?token=abc&page=2#/inbox' });
  assert.equal(web['target'], 'https://app.example.com/?page=2#/inbox');
  assert.equal(app.state.bookmarks.require(String(web['id'])).target, 'https://app.example.com/?page=2#/inbox');
  const bad = await call(app, 'POST', '/v2/bookmarks', { cookie, body: { requestId: newRequestId('bm'), kind: 'web',
    title: '本地文件', target: 'file:///etc/hosts' } });
  assert.equal(bad.status, 400);
  const page = await add(app, cookie, { kind: 'page', title: 'Plasticine 理论', target: '#/notes/theory' });
  assert.equal(page['target'], '#/notes/theory');
  const wrong = await call(app, 'POST', '/v2/bookmarks', { cookie, body: { requestId: newRequestId('bm'),
    kind: 'page', title: '错的', target: 'notes/theory' } });
  assert.equal(wrong.status, 400);
});

test('保存的分组：带每一页；没有页不收', async () => {
  const { app, cookie } = await start();
  const group = await add(app, cookie, { kind: 'group', title: '冷启动渠道', projectId: STANDING_PROJECT_IDS.plasticine,
    tabs: [{ kind: 'web', title: 'Show HN', target: 'https://news.ycombinator.com/' },
      { kind: 'page', title: '项目页', target: '#/projects/project-plasticine' }] });
  assert.equal(group['target'], null);
  assert.equal((group['tabs'] as Body[]).length, 2);
  const empty = await call(app, 'POST', '/v2/bookmarks', { cookie, body: { requestId: newRequestId('bm'),
    kind: 'group', title: '空的', tabs: [] } });
  assert.equal(empty.status, 400);
});

test('改名、移到别的项目；过时的 version 回 409 带现在的；移除后不在列表里，行还在', async () => {
  const { app, cookie } = await start();
  const row = await add(app, cookie, { kind: 'web', title: '旧名字', target: 'https://example.com/a' });
  const id = String(row['id']);
  const edit = await call(app, 'PUT', `/v2/bookmarks/${id}`, { cookie, body: { requestId: newRequestId('ed'),
    version: row['version'], title: '新名字', projectId: STANDING_PROJECT_IDS.personal } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const edited = json(edit)['bookmark'] as Body;
  assert.deepEqual([edited['title'], edited['projectId']], ['新名字', STANDING_PROJECT_IDS.personal]);
  const stale = await call(app, 'PUT', `/v2/bookmarks/${id}`, { cookie, body: { requestId: newRequestId('ed'),
    version: row['version'], title: '又改' } });
  assert.equal(stale.status, 409);
  assert.equal((json(stale)['current'] as Body)['title'], '新名字');
  const missing = await call(app, 'PUT', `/v2/bookmarks/${id}`, { cookie, body: { requestId: newRequestId('ed'),
    version: edited['version'], projectId: 'project-nope' } });
  assert.equal(missing.status, 404);
  const removed = await call(app, 'POST', `/v2/bookmarks/${id}/remove`, { cookie,
    body: { requestId: newRequestId('rm'), version: edited['version'] } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(await list(app, cookie), []);
  assert.notEqual(app.state.bookmarks.require(id).deletedAt, null);
});

test('撤销移除：回到原来的位置；同一个网址这期间又加了一条就回那一条，不出两条；过时的 409', async () => {
  const { app, cookie } = await start();
  const a = await add(app, cookie, { kind: 'web', title: 'A', target: 'https://a.example.com/' });
  await add(app, cookie, { kind: 'web', title: 'B', target: 'https://b.example.com/' });
  const removed = json(await call(app, 'POST', `/v2/bookmarks/${String(a['id'])}/remove`, { cookie,
    body: { requestId: newRequestId('rm'), version: a['version'] } }))['bookmark'] as Body;
  const stale = await call(app, 'POST', `/v2/bookmarks/${String(a['id'])}/restore`, { cookie,
    body: { requestId: newRequestId('rs'), version: a['version'] } });
  assert.equal(stale.status, 409);
  const restored = await call(app, 'POST', `/v2/bookmarks/${String(a['id'])}/restore`, { cookie,
    body: { requestId: newRequestId('rs'), version: removed['version'] } });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal((json(restored)['bookmark'] as Body)['id'], a['id']);
  assert.deepEqual((await list(app, cookie)).map((row) => row['title']), ['A', 'B']);
  assert.equal(app.state.bookmarks.require(String(a['id'])).deletedAt, null);

  const again = json(await call(app, 'POST', `/v2/bookmarks/${String(a['id'])}/remove`, { cookie,
    body: { requestId: newRequestId('rm'), version: (json(restored)['bookmark'] as Body)['version'] } }))['bookmark'];
  const twin = await add(app, cookie, { kind: 'web', title: 'A 又加', target: 'https://a.example.com/' });
  const back = await call(app, 'POST', `/v2/bookmarks/${String(a['id'])}/restore`, { cookie,
    body: { requestId: newRequestId('rs'), version: (again as Body)['version'] } });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal((json(back)['bookmark'] as Body)['id'], twin['id']);
  assert.equal((await list(app, cookie)).length, 2);
});

test('书签改了（加、改名、移除、撤销、排序）告诉各设备：bookmarks_changed', async () => {
  const { app, cookie } = await start();
  const seen: string[] = [];
  const publish = app.app.deps.hub.publish.bind(app.app.deps.hub);
  app.app.deps.hub.publish = (event) => {
    seen.push(event.type);
    return publish(event);
  };
  const row = await add(app, cookie, { kind: 'web', title: 'A', target: 'https://a.example.com/' });
  await add(app, cookie, { kind: 'web', title: 'A', target: 'https://a.example.com/' }, 200);
  const edit = json(await call(app, 'PUT', `/v2/bookmarks/${String(row['id'])}`, { cookie,
    body: { requestId: newRequestId('ed'), version: row['version'], title: '新名字' } }))['bookmark'] as Body;
  await call(app, 'POST', '/v2/bookmarks/order', { cookie, body: { requestId: newRequestId('or'), ids: [row['id']] } });
  await call(app, 'POST', `/v2/bookmarks/${String(row['id'])}/remove`, { cookie,
    body: { requestId: newRequestId('rm'), version: edit['version'] } });
  assert.deepEqual(seen.filter((type) => type === 'bookmarks_changed').length, 4, '同一个网址再加一次没改，不发');
});

test('排序：按给的先后，没列到的排后面', async () => {
  const { app, cookie } = await start();
  const a = await add(app, cookie, { kind: 'web', title: 'A', target: 'https://a.example.com/' });
  const b = await add(app, cookie, { kind: 'web', title: 'B', target: 'https://b.example.com/' });
  const c = await add(app, cookie, { kind: 'web', title: 'C', target: 'https://c.example.com/' });
  const reply = await call(app, 'POST', '/v2/bookmarks/order', { cookie,
    body: { requestId: newRequestId('or'), ids: [c['id'], a['id']] } });
  assert.equal(reply.status, 200);
  assert.deepEqual((json(reply)['bookmarks'] as Body[]).map((row) => row['title']), ['C', 'A', 'B']);
  assert.equal(b['position'], 1);
});

test('导入：坏网址和已经有的跳过，一次里重复的只留一条；对不上的项目当没归项目', async () => {
  const { app, cookie } = await start();
  await add(app, cookie, { kind: 'web', title: '已有', target: 'https://example.com/have' });
  const reply = await call(app, 'POST', '/v2/bookmarks/import', { cookie, body: { requestId: newRequestId('im'),
    items: [
      { title: '已有', url: 'https://example.com/have', projectId: null },
      { title: 'WKWebView', url: 'https://developer.apple.com/wkwebview', projectId: STANDING_PROJECT_IDS.plasticine },
      { title: 'WKWebView 再来', url: 'https://developer.apple.com/wkwebview', projectId: null },
      { title: '', url: 'https://weather.com.cn/', projectId: 'project-gone' },
      { title: '脚本', url: 'javascript:alert(1)', projectId: null },
    ] } });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual([json(reply)['added'], json(reply)['skipped']], [2, 3]);
  const rows = await list(app, cookie);
  const weather = rows.find((row) => row['target'] === 'https://weather.com.cn/');
  assert.deepEqual([weather?.['title'], weather?.['projectId'], weather?.['origin']],
    ['https://weather.com.cn/', null, 'import']);
});

test('信息流收藏和书签分开：收藏不加书签、不记来源；同一网址的书签在书签页移除，信息流收藏不受影响', async () => {
  const { app, cookie } = await start();
  const itemId = feedItem(app);
  const saved = await call(app, 'POST', `/v2/feed/items/${itemId}/save`, { cookie,
    body: { requestId: newRequestId('sv'), version: 1, saved: true } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(await list(app, cookie), [], '收藏不进书签');
  const bookmarkTriggers = app.state.triggers.since('2000-01-01T00:00:00.000Z')
    .filter((trigger) => trigger.kind === 'bookmark.added');
  assert.deepEqual(bookmarkTriggers, [], '收藏不经书签记事与来源');
  const bookmark = await add(app, cookie, { kind: 'web', title: '本地优先软件', target: 'https://example.com/lofi' });
  assert.equal(bookmark['origin'], 'manual');
  const removed = await call(app, 'POST', `/v2/bookmarks/${String(bookmark['id'])}/remove`, { cookie,
    body: { requestId: newRequestId('rm'), version: bookmark['version'] } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const item = json(await call(app, 'GET', `/v2/feed/items/${itemId}`, { cookie }))['item'] as Body;
  assert.equal(item['saved'], true, '书签页移除不动信息流收藏');
  const unsaved = await call(app, 'POST', `/v2/feed/items/${itemId}/save`, { cookie,
    body: { requestId: newRequestId('sv'), version: item['version'], saved: false } });
  assert.equal(unsaved.status, 200);
  assert.equal(app.state.bookmarks.all().length, 1, '取消收藏也不碰书签');
});
test('没归项目的书签推一个项目：同一个网站的多半在哪个项目就推哪个；拿不准不推', async () => {
  const { app, cookie } = await start();
  for (const path of ['a', 'b']) {
    await add(app, cookie, { kind: 'web', title: path, target: `https://github.com/example/${path}`,
      projectId: STANDING_PROJECT_IDS.plasticine });
  }
  await add(app, cookie, { kind: 'web', title: 'c', target: 'https://github.com/example/c' });
  await add(app, cookie, { kind: 'web', title: '没头绪', target: 'https://unknown.example.com/' });
  const rows = await list(app, cookie);
  assert.equal(rows.find((row) => row['title'] === 'c')?.['suggestedProjectId'], STANDING_PROJECT_IDS.plasticine);
  assert.equal(rows.find((row) => row['title'] === '没头绪')?.['suggestedProjectId'], null);
  assert.equal(rows.find((row) => row['title'] === 'a')?.['suggestedProjectId'], null);
});

test('加了书签记进来源（书签 · 只记）；⌘K 查得到名字和存下的正文快照', async () => {
  const { app, cookie } = await start();
  const row = await add(app, cookie, { kind: 'web', title: 'Agents that ask before they act',
    target: 'https://arxiv.org/abs/2510.00001', snapshot: { text: '先问再做的代理在可逆性低的动作前停下。', totalChars: 18 } });
  const source = app.state.intakeSources.byKind('bookmark')[0];
  assert.equal(source?.label, '书签');
  const triggers = app.state.triggers.since('2000-01-01T00:00:00.000Z')
    .filter((trigger) => trigger.sourceId === source?.id);
  assert.deepEqual(triggers.map((trigger) => [trigger.kind, trigger.refId]), [['bookmark.added', row['id']]]);
  assert.deepEqual(app.state.dispositions.forTrigger(triggers[0]!.id).map((entry) => entry.kind), ['recorded']);
  const search = json(await call(app, 'GET', `/v2/search?q=${encodeURIComponent('可逆性')}`, { cookie }));
  assert.deepEqual((search['results'] as Body[]).map((result) => [result['kind'], result['id']]),
    [['bookmark', row['id']]]);
  const byTitle = json(await call(app, 'GET', '/v2/search?q=ask%20before&type=bookmarks', { cookie }));
  assert.equal((byTitle['results'] as Body[]).length, 1);
});
