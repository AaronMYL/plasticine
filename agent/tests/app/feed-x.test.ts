// 第 3 批信息流：Mac 在线时读 X「关注」时间线，交给服务端（GET / POST /v2/nodes/feed/x，节点 Bearer）；界面按
// X · 订阅 · 新闻分段（GET /v2/feed?kind=），卡片的头像和配图走服务端图片代理；设置里每个来源一行带上次的结果。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { FeedListResponseSchema, FeedSourcesResponseSchema, XTimelineDueSchema } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp, newRequestId, send } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function pairedNode(app: TestApp, cookie: string): Promise<string> {
  const code = await send(app, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId('code') },
    { cookie });
  const reply = await call(app, 'POST', '/v2/nodes/pair', { body: { requestId: newRequestId('pair'),
    code: String(json(code)['code']), name: '家里的 Mac', platform: 'macos', appVersion: '0.5.0', protocolVersion: 1,
    capabilities: ['file_read'] } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return String(json(reply)['credential']);
}

const POST = { id: '1850000000000000001', handle: 'mayabuilds', author: 'Maya Chen',
  avatar: 'https://pbs.twimg.com/profile_images/1/maya_normal.jpg', text: 'shipped: bounty board for agents',
  image: 'https://pbs.twimg.com/media/abc.jpg?format=jpg&name=small', imageRatio: 0.6,
  publishedAt: '2026-11-04T06:58:00.000Z' };

test('X 时间线：没有节点凭证 401；节点问到点、交帖子入库；按 X 分段列出，头像和配图换成代理地址', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/nodes/feed/x')).status, 401);
  assert.equal((await call(t, 'POST', '/v2/nodes/feed/x', { cookie,
    body: { requestId: 'x-read-0001', posts: [POST], error: null } })).status, 401);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const due = await call(t, 'GET', '/v2/nodes/feed/x', { headers });
  assert.equal(due.status, 200);
  assert.ok(Value.Check(XTimelineDueSchema, due.body));
  assert.deepEqual(due.body, { due: true, everyMinutes: 120 });
  assert.equal((await call(t, 'POST', '/v2/nodes/feed/x', { headers,
    body: { requestId: 'x-read-0001', posts: [{ ...POST, handle: '../etc' }], error: null } })).status, 400);
  const report = await call(t, 'POST', '/v2/nodes/feed/x', { headers,
    body: { requestId: 'x-read-0001', posts: [POST], error: null } });
  assert.deepEqual(report.body, { added: 1 });
  assert.equal(json(await call(t, 'GET', '/v2/nodes/feed/x', { headers }))['due'], false);

  const list = await call(t, 'GET', '/v2/feed?tz=UTC&kind=x', { cookie });
  assert.ok(Value.Check(FeedListResponseSchema, list.body));
  const [item] = (list.body as { items: { kind: string; author: { name: string; handle: string; avatar: string };
    image: { src: string; ratio: number }; url: string }[] }).items;
  assert.equal(item?.kind, 'x');
  assert.equal(item?.url, 'https://x.com/mayabuilds/status/1850000000000000001');
  assert.equal(item?.author.name, 'Maya Chen');
  assert.equal(item?.author.handle, 'mayabuilds');
  assert.match(item?.author.avatar ?? '', /^\/v2\/mail-image\?u=https%3A%2F%2Fpbs\.twimg\.com/);
  assert.match(item?.image.src ?? '', /^\/v2\/mail-image\?u=.*&e=\d+&s=/);
  assert.equal(item?.image.ratio, 0.6);
  assert.equal((json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=rss', { cookie }))['items'] as unknown[]).length, 0);
  assert.equal((json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=news', { cookie }))['items'] as unknown[]).length, 0);
  assert.equal((await call(t, 'GET', '/v2/feed?tz=UTC&kind=mail', { cookie })).status, 400);
});

test('X 读不到：设置里 X 那一行带原因；订阅和「按关注点搜新闻」各一行，订阅给多久抓一次', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  assert.equal((await call(t, 'POST', '/v2/nodes/feed/x', { headers,
    body: { requestId: 'x-read-0002', posts: [], error: { code: 'signed_out' } } })).status, 200);
  const sources = await call(t, 'GET', '/v2/feed/sources', { cookie });
  assert.ok(Value.Check(FeedSourcesResponseSchema, sources.body));
  const body = json(sources);
  assert.equal(body['everyMinutes'], 120);
  const others = body['others'] as { kind: string; ref?: string; label: string; status?: { error: string | null } }[];
  const x = others.find((source) => source.kind === 'x');
  assert.equal(x?.ref, 'x:following');
  assert.equal(x?.status?.error, '在 Plasticine 浏览器里登录 X');
  const news = others.find((source) => source.ref === 'internal:news');
  assert.equal(news?.label, '兴趣');
  assert.equal(news?.status, undefined);
});

function placed(id: string, places: string[] | undefined, hoursAgo: number): Record<string, unknown> {
  return { ...POST, id, text: `第 ${id} 条`, ...(places === undefined ? {} : { places }),
    publishedAt: new Date(Date.parse('2026-11-04T06:58:00.000Z') - hoursAgo * 3_600_000).toISOString() };
}

test('X 三处（第13批）：帖子带在哪几处看到的；每处各取最新的几条（书签里的旧帖不被挤掉）；又在别处看到的并进去', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  // 正在关注 12 条新帖（正常档一轮每处 10 条），书签 2 条很旧的，还有一条没写在哪的（Mac App 还没升级）。
  const following = Array.from({ length: 12 }, (_, index) => placed(String(1000 + index), ['following'], index));
  const marked = [placed('2001', ['bookmark'], 300), placed('2002', ['recommend', 'bookmark'], 400)];
  const report = await call(t, 'POST', '/v2/nodes/feed/x', { headers, body: { requestId: 'x-read-0003',
    posts: [...following, ...marked, placed('3001', undefined, 0.5)], error: null } });
  assert.equal(report.status, 200, JSON.stringify(report.body));
  // 正在关注取最新 10 条（含没写在哪的那条），书签两条、推荐一条（和书签同一条）。
  assert.deepEqual(report.body, { added: 12 });
  const items = (): Promise<{ url: string; places?: string[] }[]> => call(t!, 'GET', '/v2/feed?tz=UTC&kind=x&limit=50',
    { cookie }).then((reply) => (reply.body as { items: { url: string; places?: string[] }[] }).items);
  const byId = async (id: string): Promise<string[] | undefined> =>
    (await items()).find((item) => item.url.endsWith(`/${id}`))?.places;
  assert.deepEqual(await byId('2002'), ['recommend', 'bookmark']);
  assert.deepEqual(await byId('3001'), ['following']);
  assert.deepEqual(await byId('1000'), ['following']);
  assert.equal(await byId('1009'), undefined);
  assert.equal(await byId('1011'), undefined);
  const marks = await call(t, 'GET', '/v2/feed?tz=UTC&kind=x&place=bookmark', { cookie });
  assert.deepEqual((marks.body as { items: { url: string }[] }).items.map((item) => item.url.split('/').at(-1)),
    ['2001', '2002']);
  // 下一轮：1000 又在书签里看到了，并进去；不另加一条。
  const again = await call(t, 'POST', '/v2/nodes/feed/x', { headers, body: { requestId: 'x-read-0004',
    posts: [placed('1000', ['bookmark'], 0)], error: null } });
  assert.deepEqual(again.body, { added: 0 });
  assert.deepEqual(await byId('1000'), ['following', 'bookmark']);
  const nav = await call(t, 'GET', '/v2/feed/nav?tz=UTC', { cookie });
  const x = (nav.body as { sources: { kind: string; places?: Record<string, number> }[] }).sources
    .find((row) => row.kind === 'x');
  assert.deepEqual(x?.places, { following: 10, recommend: 1, bookmark: 3 });
});

test('X 一条多张图（11-14 图片统一）：按顺序存四张，界面拿到封面和另外三张代理地址；以前只存了封面的再读到补上', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const media = (name: string): string => `https://pbs.twimg.com/media/${name}.jpg`;
  const images = [{ url: media('a'), ratio: 0.6 }, { url: media('b'), ratio: 1 }, { url: media('c'), ratio: null },
    { url: media('d'), ratio: 1.25 }];
  // 旧版客户端只给 image 的一条，和新版给 images 的一条。
  const old = { ...POST, id: '4001', image: media('z'), imageRatio: 0.5 };
  const fresh = { ...POST, id: '4002', image: media('a'), imageRatio: 0.6, images };
  const report = await call(t, 'POST', '/v2/nodes/feed/x', { headers,
    body: { requestId: 'x-read-0005', posts: [old, fresh], error: null } });
  assert.deepEqual(report.body, { added: 2 });
  type Shown = { url: string; image: { src: string; ratio: number | null } | null;
    moreImages: { src: string; ratio: number | null }[] };
  const shown = async (id: string): Promise<Shown | undefined> => {
    const list = await call(t!, 'GET', '/v2/feed?tz=UTC&kind=x', { cookie });
    assert.ok(Value.Check(FeedListResponseSchema, list.body));
    return (list.body as { items: Shown[] }).items.find((item) => item.url.endsWith(`/${id}`));
  };
  const proxiedOf = (src: string): string => new URL(src, 'http://local').searchParams.get('u') ?? '';
  const four = await shown('4002');
  assert.equal(proxiedOf(four?.image?.src ?? ''), media('a'));
  assert.deepEqual(four?.moreImages.map((image) => [proxiedOf(image.src), image.ratio]),
    [[media('b'), 1], [media('c'), null], [media('d'), 1.25]]);
  assert.deepEqual((await shown('4001'))?.moreImages, []);
  // 新版客户端又读到 4001（这回有三张）：封面不动，补上另外两张；再读一遍不再改。
  const again = { ...old, images: [{ url: media('z'), ratio: 0.5 }, { url: media('y'), ratio: 1 },
    { url: media('x'), ratio: null }] };
  assert.deepEqual((await call(t, 'POST', '/v2/nodes/feed/x', { headers,
    body: { requestId: 'x-read-0006', posts: [again], error: null } })).body, { added: 0 });
  const filled = await shown('4001');
  assert.equal(proxiedOf(filled?.image?.src ?? ''), media('z'));
  assert.deepEqual(filled?.moreImages.map((image) => proxiedOf(image.src)), [media('y'), media('x')]);
  // 超过四张的 400（客户端最多交四张）。
  assert.equal((await call(t, 'POST', '/v2/nodes/feed/x', { headers, body: { requestId: 'x-read-0007',
    posts: [{ ...fresh, id: '4003', images: [...images, { url: media('e'), ratio: null }] }], error: null } })).status,
  400);
});
