import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp, newRequestId } from './helpers.ts';

let t: TestApp | undefined;
let site: Server | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
  if (site !== undefined) {
    await new Promise<void>((resolve) => site!.close(() => resolve()));
    site = undefined;
  }
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61', 'hex');

function tab(id: string, url: string) {
  return { id, kind: 'web', url, title: id, openedBy: 'user', openedAt: '2026-11-08T01:00:00.000Z',
    visitedAt: '2026-11-08T01:00:00.000Z' };
}

function layout(partial: Record<string, unknown> = {}) {
  return { tabs: [], pinned: [], groups: [], today: [], archived: [], ...partial };
}

test('tabs API: 401 unauth, empty v0 default, full write bumps version, 409 stale with current', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/web-tabs')).status, 401);
  assert.deepEqual(json(await call(t, 'GET', '/v2/web-tabs', { cookie })), { layout: layout(), version: 0 });
  const mine = layout({ tabs: [tab('a', 'https://a.example.com/')], today: ['a'] });
  const put = await call(t, 'PUT', '/v2/web-tabs', { cookie,
    body: { requestId: newRequestId('wt'), baseVersion: 0, layout: mine } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(json(put), { version: 1 });
  assert.deepEqual(json(await call(t, 'GET', '/v2/web-tabs', { cookie })), { layout: mine, version: 1 });
  const stale = await call(t, 'PUT', '/v2/web-tabs', { cookie,
    body: { requestId: newRequestId('wt'), baseVersion: 0, layout: layout() } });
  assert.equal(stale.status, 409);
  assert.deepEqual(json(stale)['current'], { layout: mine, version: 1 });
});

test('merging legacy archive skips duplicate URLs and returns merged snapshot', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  await call(t, 'PUT', '/v2/web-tabs', { cookie, body: { requestId: newRequestId('wt'), baseVersion: 0,
    layout: layout({ tabs: [tab('a', 'https://a.example.com/')], today: ['a'] }) } });
  const merged = await call(t, 'POST', '/v2/web-tabs/merge', { cookie, body: { requestId: newRequestId('wt'),
    layout: layout({ tabs: [tab('x', 'https://a.example.com/'), tab('y', 'https://y.example.com/')],
      pinned: ['y'], today: ['x'] }) } });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const body = json(merged);
  assert.equal(body['version'], 2);
  assert.deepEqual((body['layout'] as { pinned: string[]; today: string[] }).pinned, ['y']);
  assert.deepEqual((body['layout'] as { pinned: string[]; today: string[] }).today, ['a']);
});

test('merging legacy Bookmarks group converts pages into bookmarks without duplicating existing', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const existing = await call(t, 'POST', '/v2/bookmarks', { cookie, body: { requestId: newRequestId('bm'),
    kind: 'web', title: '已有的', target: 'https://kept.example.com/' } });
  assert.equal(existing.status, 201, JSON.stringify(existing.body));
  const merged = await call(t, 'POST', '/v2/web-tabs/merge', { cookie, body: { requestId: newRequestId('wt'),
    layout: layout({
      tabs: [tab('b1', 'https://kept.example.com/'), tab('b2', 'https://new.example.com/page'),
        tab('g1', 'https://grouped.example.com/'), tab('t1', 'https://today.example.com/')],
      groups: [{ id: 'wtg-bookmarks', name: '书签', hue: 'ochre', collapsed: true, tabIds: ['b1', 'b2'] },
        { id: 'g-work', name: '工作', hue: 'sky', collapsed: false, tabIds: ['g1'] }],
      today: ['t1'],
    }) } });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const saved = json(merged)['layout'] as { groups: { name: string }[]; tabs: { url: string }[] };
  assert.deepEqual(saved.groups.map((group) => group.name), ['工作']);
  assert.deepEqual(saved.tabs.map((entry) => entry.url).sort(),
    ['https://grouped.example.com/', 'https://today.example.com/']);
  const list = json(await call(t, 'GET', '/v2/bookmarks', { cookie }))['bookmarks'] as { target: string }[];
  assert.deepEqual(list.map((entry) => entry.target), ['https://kept.example.com/', 'https://new.example.com/page']);
});

async function startSite(handler: (path: string) => { status: number; type?: string; body?: Buffer | string })
  : Promise<{ port: number; hits: string[] }> {
  const hits: string[] = [];
  site = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const answer = handler(path);
    res.writeHead(answer.status, answer.type === undefined ? {} : { 'content-type': answer.type });
    res.end(answer.body ?? '');
  });
  await new Promise<void>((resolve) => site!.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  assert.ok(address !== null && typeof address === 'object');
  return { port: address.port, hits };
}

function favicons(port: number) {
  return { resolve: async () => [{ address: '127.0.0.1', family: 4 }], blocked: () => false,
    pages: (host: string) => [`http://${host}:${port}/`] };
}

test('favicon reads home <link rel=\'icon\'>, sniffs bytes, caches in DB to avoid second fetch', async () => {
  const served = await startSite((path) => path === '/'
    ? { status: 200, type: 'text/html', body: '<html><head><link rel="shortcut icon" href="/static/i.png">'
      + '<link rel="apple-touch-icon" href="/big.png"></head><body></body></html>' }
    : path === '/static/i.png' ? { status: 200, type: 'application/octet-stream', body: PNG }
      : { status: 404 });
  t = await startTestApp([], { startTasks: false, favicons: favicons(served.port) });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/favicon?host=example.com')).status, 401);
  const first = await call(t, 'GET', '/v2/favicon?host=example.com', { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.match(first.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.deepEqual(Buffer.from(first.body as ArrayBuffer), PNG);
  const again = await call(t, 'GET', '/v2/favicon?host=example.com', { cookie });
  assert.equal(again.status, 200);
  assert.deepEqual(served.hits, ['/', '/static/i.png']);
});

test('missing favicon returns 404 and caches negative entry until expiry', async () => {
  const served = await startSite((path) => path === '/'
    ? { status: 200, type: 'text/html', body: '<html><head><title>x</title></head></html>' }
    : { status: 404 });
  t = await startTestApp([], { startTasks: false, favicons: favicons(served.port) });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/favicon?host=plain.example.org', { cookie })).status, 404);
  assert.equal((await call(t, 'GET', '/v2/favicon?host=plain.example.org', { cookie })).status, 404);
  assert.deepEqual(served.hits, ['/', '/favicon.ico']);
  assert.equal(t.state.favicons.get('plain.example.org')?.status, 'none');
});

test('SSRF guard blocks localhost/private IPs (404, no fetch) and non-hostname input (400)', async () => {
  const served = await startSite(() => ({ status: 200, type: 'image/png', body: PNG }));
  t = await startTestApp([], { startTasks: false, favicons: { resolve: async () => [{ address: '127.0.0.1',
    family: 4 }], pages: (host) => [`http://${host}:${served.port}/`] } });
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/favicon?host=evil.example.com', { cookie })).status, 404);
  assert.deepEqual(served.hits, []);
  for (const host of ['localhost', '127.0.0.1', 'a.com:8080', 'a.com/x', 'user@a.com', '']) {
    assert.equal((await call(t, 'GET', `/v2/favicon?host=${encodeURIComponent(host)}`, { cookie })).status, 400, host);
  }
});

test('desktop-reported favicon caches by page host for other devices; non-image returns 400', async () => {
  const served = await startSite(() => ({ status: 500 }));
  t = await startTestApp([], { startTasks: false, favicons: favicons(served.port) });
  const cookie = await pair(t);
  const icon = `data:image/png;base64,${PNG.toString('base64')}`;
  const put = await call(t, 'PUT', '/v2/favicon', { cookie, body: { requestId: newRequestId('fi'),
    pageUrl: 'https://www.shell.example.com/a/b?c=1', icon } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(json(put), { host: 'shell.example.com' });
  const got = await call(t, 'GET', '/v2/favicon?host=shell.example.com', { cookie: await pair(t, '另一台') });
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(got.body as ArrayBuffer), PNG);
  assert.deepEqual(served.hits, []);
  const bad = await call(t, 'PUT', '/v2/favicon', { cookie, body: { requestId: newRequestId('fi'),
    pageUrl: 'https://shell.example.com/',
    icon: `data:image/png;base64,${Buffer.from('<html>').toString('base64')}` } });
  assert.equal(bad.status, 400);
  const local = await call(t, 'PUT', '/v2/favicon', { cookie, body: { requestId: newRequestId('fi'),
    pageUrl: 'file:///a.html', icon } });
  assert.equal(local.status, 400);
});
