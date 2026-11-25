import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withClientFiles } from '../../src/app/static-client.ts';

interface Served {
  url: string;
  apiCalls: string[];
  close(): Promise<void>;
}

async function serve(t: { after(fn: () => void | Promise<void>): void }, directory: string): Promise<Served> {
  const apiCalls: string[] = [];
  const api = (req: IncomingMessage, res: ServerResponse): void => {
    apiCalls.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"api":true}');
  };
  const server = createServer(withClientFiles(directory, api));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = (): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
  t.after(close);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiCalls, close };
}

function clientBuild(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-static-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Plasticine</title>');
  writeFileSync(join(directory, 'assets', 'app-1a2b.js'), 'console.log("中文");');
  writeFileSync(join(directory, 'client-manifest.json'), '{"buildId":"x"}');
  return directory;
}

test('/v2/ requests pass through to API without touching static files', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/v2/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api: true });
  assert.deepEqual(served.apiCalls, ['/v2/health']);
});

test('root path serves index.html with no-cache revalidation', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.match(await response.text(), /<title>Plasticine<\/title>/);
  assert.deepEqual(served.apiCalls, []);
});

test('hashed build assets serve with long cache and MIME type by extension', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/assets/app-1a2b.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/javascript/);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await response.text(), 'console.log("中文");');
});

test('unknown page paths fall back to index.html for non-hash deep links', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/today/anything`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Plasticine/);
});

test('missing build asset returns 404 instead of serving index.html as script', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/assets/missing.js`);
  assert.equal(response.status, 404);
});

test('path traversal outside build directory is always rejected', async (t) => {
  const directory = clientBuild(t);
  writeFileSync(join(directory, '..', 'plasticine-static-secret.txt'), 'secret');
  t.after(() => rmSync(join(directory, '..', 'plasticine-static-secret.txt'), { force: true }));
  const served = await serve(t, directory);
  for (const path of ['/..%2fplasticine-static-secret.txt', '/assets/..%2f..%2fplasticine-static-secret.txt',
    '/%00index.html']) {
    const response = await fetch(`${served.url}${path}`);
    assert.notEqual(await response.text(), 'secret', path);
    assert.ok([400, 404].includes(response.status), `${path} → ${response.status}`);
  }
});

test('static handler accepts GET and HEAD only; other methods return 405', async (t) => {
  const served = await serve(t, clientBuild(t));
  const head = await fetch(`${served.url}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(`${served.url}/`, { method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
});

test('serves precompressed .br/.gz per Accept-Encoding with original MIME type and Vary', async (t) => {
  const directory = clientBuild(t);
  const { brotliCompressSync, gzipSync, brotliDecompressSync } = await import('node:zlib');
  const source = 'console.log("中文");'.repeat(200);
  writeFileSync(join(directory, 'assets', 'big-9f8e.js'), source);
  writeFileSync(join(directory, 'assets', 'big-9f8e.js.br'), brotliCompressSync(source));
  writeFileSync(join(directory, 'assets', 'big-9f8e.js.gz'), gzipSync(source));
  const served = await serve(t, directory);
  const http = await import('node:http');
  const get = (encoding: string): Promise<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> =>
    new Promise((resolve, reject) => {
      http.get(`${served.url}/assets/big-9f8e.js`, { headers: { 'accept-encoding': encoding } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  const br = await get('gzip, br');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.match(String(br.headers['content-type']), /^text\/javascript/);
  assert.match(String(br.headers['vary']), /accept-encoding/i);
  assert.equal(br.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(brotliDecompressSync(br.body).toString(), source);
  const gz = await get('gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  const plain = await get('identity');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), source);
});

test('serves uncompressed file when precompressed variant is absent', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/assets/app-1a2b.js`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(await response.text(), 'console.log("中文");');
});
