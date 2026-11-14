// 第13批（11-14 Aaron：加「小红书」，抓首页「推荐」和自己的收藏，合并、去重，标「推荐」「收藏」，两处都有就两个标都留）：
// 电脑客户端在线时来问到没到读小红书的时候（GET /v2/nodes/feed/xhs，节点 Bearer），读完把笔记交来入库（POST）；
// 没读到只记原因（没登录、要验证），来源那一行写出来；「现在刷新」把它记成到点。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { FeedListResponseSchema, XhsDueSchema } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey, signedCall } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function pairedNode(app: TestApp, cookie: string): Promise<string> {
  const key = newDeviceKey();
  assert.equal((await registerKey(app, cookie, key)).status, 201);
  const code = await signedCall(app, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId('code') },
    { cookie, key });
  const reply = await call(app, 'POST', '/v2/nodes/pair', { body: { requestId: newRequestId('pair'),
    code: String(json(code)['code']), name: '家里的电脑', platform: 'macos', appVersion: '0.5.0', protocolVersion: 1,
    capabilities: ['file_read'] } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return String(json(reply)['credential']);
}

function note(id: string, places: string[], title = `笔记 ${id.slice(-2)}`): Record<string, unknown> {
  return { id, title, author: '收纳小周',
    avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/a.jpg', image: 'https://sns-webpic-qc.xhscdn.com/cover.webp',
    imageRatio: 1.333, video: false, places };
}

const A = '6614a2b3000000001a0123ab';
const B = '6614a2b3000000001a0123cd';

interface ItemBody { url: string; title: string; places?: string[]; author: { name: string; avatar: string | null };
  image: { src: string } | null; kind: string }

test('小红书：没有节点凭证 401；节点问到点、交笔记入库；卡片有作者、封面、在哪看到的', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/nodes/feed/xhs')).status, 401);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const due = await call(t, 'GET', '/v2/nodes/feed/xhs', { headers });
  assert.ok(Value.Check(XhsDueSchema, due.body));
  assert.deepEqual(due.body, { due: true, everyMinutes: 120 });
  assert.equal((await call(t, 'POST', '/v2/nodes/feed/xhs', { headers,
    body: { requestId: 'xhs-read-0001', notes: [note('../etc', ['recommend'])], error: null } })).status, 400);
  const report = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-read-0001',
    notes: [note(A, ['recommend', 'saved'], '桌面整理：一块木板'), note(B, ['saved'])], error: null } });
  assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.deepEqual(report.body, { added: 2 });
  assert.equal(json(await call(t, 'GET', '/v2/nodes/feed/xhs', { headers }))['due'], false);

  const list = await call(t, 'GET', '/v2/feed?tz=UTC&kind=xhs', { cookie });
  assert.ok(Value.Check(FeedListResponseSchema, list.body));
  const items = (list.body as { items: ItemBody[] }).items;
  assert.deepEqual(items.map((item) => item.places), [['recommend', 'saved'], ['saved']]);
  const [first] = items;
  assert.equal(first?.kind, 'xhs');
  assert.equal(first?.title, '桌面整理：一块木板');
  assert.equal(first?.url, `https://www.xiaohongshu.com/explore/${A}`);
  assert.equal(first?.author.name, '收纳小周');
  assert.match(first?.author.avatar ?? '', /^\/v2\/mail-image\?u=https%3A%2F%2Fsns-avatar-qc\.xhscdn\.com/);
  assert.match(first?.image?.src ?? '', /^\/v2\/mail-image\?u=/);
  const saved = await call(t, 'GET', '/v2/feed?tz=UTC&kind=xhs&place=recommend', { cookie });
  assert.deepEqual((saved.body as { items: ItemBody[] }).items.map((item) => item.url.split('/').at(-1)), [A]);
  // 下一轮 B 又在推荐里看到：并进去，不另加一条。
  const again = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-read-0002',
    notes: [note(B, ['recommend'])], error: null } });
  assert.deepEqual(again.body, { added: 0 });
  const after = (json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=xhs', { cookie }))['items'] as ItemBody[]);
  assert.deepEqual(after.find((item) => item.url.includes(B))?.places, ['saved', 'recommend']);
  // 「现在刷新」：记成到点，电脑下次来问就去读。
  const nav = await call(t, 'GET', '/v2/feed/nav?tz=UTC', { cookie });
  const row = (nav.body as { sources: { kind: string; source: { id: string; version: number } }[] }).sources
    .find((entry) => entry.kind === 'xhs');
  const refresh = await call(t, 'POST', `/v2/feed/sources/${row?.source.id ?? ''}/refresh`, { cookie,
    body: { requestId: newRequestId('refresh') } });
  assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
  assert.equal(json(await call(t, 'GET', '/v2/nodes/feed/xhs', { headers }))['due'], true);
});

test('小红书读不到：没登录、要验证，来源那一行写原因', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const status = async (): Promise<string | null | undefined> => {
    const sources = json(await call(t!, 'GET', '/v2/feed/sources', { cookie }))['others'] as
      { kind: string; status?: { error: string | null } }[];
    return sources.find((source) => source.kind === 'xhs')?.status?.error;
  };
  await call(t, 'POST', '/v2/nodes/feed/xhs', { headers,
    body: { requestId: 'xhs-read-0003', notes: [], error: { code: 'signed_out' } } });
  assert.equal(await status(), '在 Plasticine 浏览器里登录小红书');
  await call(t, 'POST', '/v2/nodes/feed/xhs', { headers,
    body: { requestId: 'xhs-read-0004', notes: [], error: { code: 'verify' } } });
  assert.equal(await status(), '小红书要你验证一下：在 Plasticine 浏览器里打开小红书，过了验证再刷新');
});
