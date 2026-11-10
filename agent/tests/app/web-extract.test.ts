import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { call, json, pair, startTestApp } from './helpers.ts';

test('网页提取和归档需登录；归档重复请求不多写一版，同网址新请求更新原空间', async () => {
  const app = await startTestApp([JSON.stringify({ keptBlocks: [0], points: [
    { text: '先记录事实', block: 0, quote: '先记录事实，再解释。' }] })], { startTasks: false });
  try {
    const cookie = await pair(app);
    const input = { url: 'https://example.com/article', title: '记录方法', text: '先记录事实，再解释。',
      totalChars: 10, truncated: false, images: [] };
    assert.equal((await call(app, 'POST', '/v2/browser/extract', { body: input })).status, 401);
    const extracted = await call(app, 'POST', '/v2/browser/extract', { cookie, body: input });
    assert.equal(extracted.status, 200);
    const body = { ...json(extracted), requestId: 'archive-web-0001' };
    const first = await call(app, 'POST', '/v2/browser/archive', { cookie, body });
    assert.equal(first.status, 200);
    assert.deepEqual(json(await call(app, 'POST', '/v2/browser/archive', { cookie, body })), json(first));
    const next = await call(app, 'POST', '/v2/browser/archive', { cookie,
      body: { ...body, requestId: 'archive-web-0002', points: [] } });
    const a = json(first)['space'] as { id: string; version: number };
    const b = json(next)['space'] as { id: string; version: number };
    assert.equal(b.id, a.id);
    assert.equal(b.version, a.version + 1);
    const empty = await call(app, 'POST', '/v2/browser/extract', { cookie, body: { ...input, text: '' } });
    assert.equal(empty.status, 400);
    app.state.spaces.markDeleted(b.id, b.version);
    const deleted = await call(app, 'POST', '/v2/browser/archive', { cookie,
      body: { ...body, requestId: 'archive-web-0003' } });
    assert.equal(deleted.status, 409);
  } finally { await app.close(); }
});

test('网页归档经安全图片代理保存原图，之后从本地资产读取', async () => {
  const image = Buffer.from('89504e470d0a1a0a', 'hex');
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(image); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const app = await startTestApp([], { startTasks: false, mailImages: {
    resolve: async () => [{ address: '127.0.0.1', family: 4 }], blocked: () => false } });
  try {
    const cookie = await pair(app);
    const response = await call(app, 'POST', '/v2/browser/archive', { cookie, body: {
      requestId: 'archive-image-0001', url: 'https://example.com/photo-article', title: '沿河走',
      totalChars: 5, truncated: false, blocks: [{ index: 0, kind: 'paragraph', text: '沿河走一走。' }], points: [],
      images: [{ url: `http://image.test:${address.port}/picture.png`, alt: '河边', afterText: '' }],
    } });
    assert.equal(response.status, 200);
    const html = (json(response).space as { html: string }).html;
    const source = /src="([^"]+)"/.exec(html)![1]!;
    assert.match(source, /^\/v2\/notes\/assets\//);
    const saved = await call(app, 'GET', source, { cookie });
    assert.equal(saved.status, 200);
    assert.deepEqual(Buffer.from(saved.body as ArrayBuffer), image);
  } finally { await app.close(); server.closeAllConnections(); server.close(); }
});
