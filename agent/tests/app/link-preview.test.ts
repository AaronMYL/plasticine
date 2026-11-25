import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { isPrivateHost } from '../../src/cloud-tools/urls.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('link preview requires auth, proxies cover via mail image proxy, rejects private networks', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const server = createServer((req, res) => {
    if (req.url === '/cover.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>示例文章</title><meta property="og:image" content="/cover.png">');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const remote = { resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    blocked: (value: string) => value !== '127.0.0.1' && isPrivateHost(value) };
  const app = await startTestApp([], { startTasks: false, mailImages: remote, linkPreviews: remote });
  try {
    const cookie = await pair(app);
    const path = `/v2/link-preview?url=${encodeURIComponent(`http://page.test:${address.port}/article`)}`;
    assert.equal((await call(app, 'GET', path)).status, 401);
    const reply = await call(app, 'GET', path, { cookie });
    assert.equal(reply.status, 200);
    assert.equal(json(reply).title, '示例文章');
    const image = String(json(reply).image);
    assert.match(image, /^\/v2\/mail-image\?u=/);
    const cover = await call(app, 'GET', image);
    assert.equal(cover.status, 200);
    assert.deepEqual(Buffer.from(cover.body as ArrayBuffer), png);
    const denied = await call(app, 'GET', '/v2/link-preview?url=http%3A%2F%2F10.1.1.1%2F', { cookie });
    assert.equal(denied.status, 400);
    assert.equal(json(denied).code, 'link_preview_refused');
  } finally {
    await app.close();
    server.closeAllConnections();
    server.close();
  }
});

test('reply image proxy requires auth, fetches http(s) only, returns image bytes, blocks private IPs', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(png);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const remote = { resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    blocked: (value: string) => value !== '127.0.0.1' && isPrivateHost(value) };
  const app = await startTestApp([], { startTasks: false, mailImages: remote, linkPreviews: remote });
  try {
    const cookie = await pair(app);
    const path = `/v2/image?url=${encodeURIComponent(`http://img.test:${address.port}/chart.png`)}`;
    assert.equal((await call(app, 'GET', path)).status, 401);
    const image = await call(app, 'GET', path, { cookie });
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(image.body as ArrayBuffer), png);
    const refused = await call(app, 'GET', `/v2/image?url=${encodeURIComponent('file:///etc/passwd')}`, { cookie });
    assert.equal(refused.status, 400);
    const inner = await call(app, 'GET', `/v2/image?url=${encodeURIComponent('http://10.1.1.1/a.png')}`, { cookie });
    assert.equal(inner.status, 502);
  } finally {
    await app.close();
    server.closeAllConnections();
    server.close();
  }
});
