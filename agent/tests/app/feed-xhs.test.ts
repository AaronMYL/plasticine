import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { FeedListResponseSchema, XhsDueSchema } from '../../shared/api/index.ts';
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

test('Xiaohongshu: 401 without node auth; polls/ingests notes with author, cover, and seen-in info', async () => {
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
  const again = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-read-0002',
    notes: [note(B, ['recommend'])], error: null } });
  assert.deepEqual(again.body, { added: 0 });
  const after = (json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=xhs', { cookie }))['items'] as ItemBody[]);
  assert.deepEqual(after.find((item) => item.url.includes(B))?.places, ['saved', 'recommend']);
  const nav = await call(t, 'GET', '/v2/feed/nav?tz=UTC', { cookie });
  const row = (nav.body as { sources: { kind: string; source: { id: string; version: number } }[] }).sources
    .find((entry) => entry.kind === 'xhs');
  const refresh = await call(t, 'POST', `/v2/feed/sources/${row?.source.id ?? ''}/refresh`, { cookie,
    body: { requestId: newRequestId('refresh') } });
  assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
  assert.equal(json(await call(t, 'GET', '/v2/nodes/feed/xhs', { headers }))['due'], true);
});

test('Xiaohongshu note preserves xsec_token in URL and backfills older notes missing it', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const first = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-token-0001',
    notes: [note(A, ['recommend'])], error: null } });
  assert.deepEqual(first.body, { added: 1 });
  const again = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-token-0002',
    notes: [{ ...note(A, ['recommend']), xsecToken: 'AB123=' }, { ...note(B, ['saved']), xsecToken: 'CD4/5=' }],
    error: null } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const items = json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=xhs', { cookie }))['items'] as ItemBody[];
  assert.deepEqual(items.map((item) => item.url).sort(), [
    `https://www.xiaohongshu.com/explore/${A}?xsec_token=AB123%3D&xsec_source=pc_feed`,
    `https://www.xiaohongshu.com/explore/${B}?xsec_token=CD4%2F5%3D&xsec_source=pc_feed`,
  ]);
  const bad = await call(t, 'POST', '/v2/nodes/feed/xhs', { headers, body: { requestId: 'xhs-token-0003',
    notes: [{ ...note(A, ['recommend']), xsecToken: 'not a token' }], error: null } });
  assert.equal(bad.status, 400);
});

test('Xiaohongshu unreadable (logged out / captcha) shows reason on source row', async () => {
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
