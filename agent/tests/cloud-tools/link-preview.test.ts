import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { test } from 'node:test';
import { LinkPreviewFetcher } from '../../src/cloud-tools/link-preview-fetch.ts';
import { PublicFetchError, PublicFetcher } from '../../src/cloud-tools/public-fetch.ts';
import { isPrivateHost } from '../../src/cloud-tools/urls.ts';

async function server() {
  const hits: IncomingHttpHeaders[] = [];
  const app = createServer((req, res) => {
    hits.push(req.headers);
    const path = req.url ?? '';
    if (path === '/inside') {
      res.writeHead(302, { location: 'http://inside.test/private' });
      res.end();
    } else if (path === '/redirect') {
      res.writeHead(302, { location: '/page' });
      res.end();
    } else if (path === '/huge') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(600 * 1024) });
      res.end();
    } else if (path === '/huge-stream') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('a'.repeat(600 * 1024));
    } else if (path === '/slow') {
    } else if (path === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>普通标题</title><meta property="og:title" content="读书 &amp; 思考">'
        + '<meta content="一本书的摘要" name="description"><meta property="og:site_name" content="示例书店">'
        + '<meta property="og:image" content="/cover.png"></head><body>正文</body></html>');
    }
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  assert.ok(address !== null && typeof address !== 'string');
  return { app, hits, url: `http://page.test:${address.port}` };
}

const blocked = (address: string) => address !== '127.0.0.1' && isPrivateHost(address);
function options() {
  return { blocked, resolve: async (host: string) => [{
    address: host === 'page.test' ? '127.0.0.1' : '10.0.0.1', family: 4,
  }] };
}
function close(app: Server): void {
  app.closeAllConnections();
  app.close();
}
async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (cause: unknown) => cause instanceof PublicFetchError && cause.code === code);
}

test('link preview reads og/title, decodes entities/relative cover, caches without Cookie/Referer', async () => {
  const served = await server();
  try {
    const fetcher = new LinkPreviewFetcher(options());
    const first = await fetcher.get(`${served.url}/page`, new AbortController().signal);
    assert.deepEqual(first, { url: `${served.url}/page`, title: '读书 & 思考', site: '示例书店',
      description: '一本书的摘要', image: `${served.url}/cover.png` });
    assert.deepEqual(await fetcher.get(`${served.url}/page`, new AbortController().signal), first);
    assert.equal(served.hits.length, 1);
    assert.equal(served.hits[0]?.cookie, undefined);
    assert.equal(served.hits[0]?.referer, undefined);
    const redirected = await fetcher.get(`${served.url}/redirect`, new AbortController().signal);
    assert.equal(redirected.url, `${served.url}/page`);
  } finally { close(served.app); }
});

test('rejects literal private IPs, private DNS, mixed DNS, and redirects to private networks', async () => {
  const served = await server();
  try {
    const signal = new AbortController().signal;
    for (const raw of ['http://127.0.0.1/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/', 'http://localhost/', 'http://printer.local/', 'http://[ff02::1]/',
      'file:///etc/passwd', 'https://name:password@example.test/']) {
      await rejects(new LinkPreviewFetcher().get(raw, signal), 'refused');
    }
    await rejects(new LinkPreviewFetcher(options()).get('http://inside.test/', signal), 'refused');
    await rejects(new LinkPreviewFetcher(options()).get(`${served.url}/inside`, signal), 'refused');
    const mixed = new LinkPreviewFetcher({ ...options(), resolve: async () => [
      { address: '127.0.0.1', family: 4 }, { address: '10.1.1.1', family: 4 },
    ] });
    await rejects(mixed.get(`${served.url}/page`, signal), 'refused');
    assert.equal(served.hits.length, 1);
  } finally { close(served.app); }
});

test('pins connection to first verified DNS IP preventing rebinding to private network', async () => {
  const served = await server();
  let lookups = 0;
  try {
    const fetcher = new LinkPreviewFetcher({ blocked, resolve: async () => {
      lookups += 1;
      return [{ address: lookups === 1 ? '127.0.0.1' : '10.0.0.1', family: 4 }];
    } });
    assert.equal((await fetcher.get(`${served.url}/page`, new AbortController().signal)).title, '读书 & 思考');
    assert.equal(lookups, 1);
  } finally { close(served.app); }
});

test('rejects non-HTML and declared or streamed oversized pages; enforces connect and DNS timeouts', async () => {
  const served = await server();
  try {
    const signal = new AbortController().signal;
    const fetcher = new LinkPreviewFetcher({ ...options(), timeoutMs: 40 });
    await rejects(fetcher.get(`${served.url}/json`, signal), 'content_type');
    await rejects(fetcher.get(`${served.url}/huge`, signal), 'too_large');
    await rejects(fetcher.get(`${served.url}/huge-stream`, signal), 'too_large');
    await rejects(fetcher.get(`${served.url}/slow`, signal), 'timeout');
    const stuck = new LinkPreviewFetcher({ timeoutMs: 40, resolve: () => new Promise(() => undefined) });
    await rejects(stuck.get('https://page.test/', signal), 'timeout');
  } finally { close(served.app); }
});

test('shared streaming public fetch for video enforces byte cap and per-hop SSRF guard', async () => {
  const served = await server();
  try {
    const fetcher = new PublicFetcher(options());
    const spec = { accept: '*/*', types: null, maxBytes: 700 * 1024, timeoutMs: 2000, userAgent: 'test' };
    let chunks = 0;
    const bytes = await fetcher.read(`${served.url}/huge-stream`, spec, new AbortController().signal,
      async (data) => {
        let size = 0;
        for await (const chunk of data) {
          chunks += 1;
          size += chunk.length;
        }
        return size;
      });
    assert.equal(bytes, 600 * 1024);
    assert.ok(chunks > 1);
    await rejects(fetcher.read(`${served.url}/huge-stream`, { ...spec, maxBytes: 50 },
      new AbortController().signal, async (data) => { for await (const _chunk of data) {  } }), 'too_large');
    await rejects(fetcher.read(`${served.url}/inside`, spec, new AbortController().signal,
      async () => undefined), 'refused');
  } finally { close(served.app); }
});
