import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compressText, MIN_COMPRESS_BYTES, pickEncoding, sensitivePath } from '../../src/app/compression.ts';
import { call, pair, startTestApp } from './helpers.ts';

test('selects Accept-Encoding: prefers br over gzip, treats q=0 as unacceptable', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding(['gzip', 'br']), 'br');
});

test('skips compression for login, account, and model-auth endpoints', () => {
  for (const path of ['/v2/session/password', '/v2/session/local', '/v2/account', '/v2/account/setup',
    '/v2/model-providers/openai-codex/login', '/v2/model-providers/openai-codex/login/callback']) {
    assert.equal(sensitivePath(path), true, path);
  }
  for (const path of ['/v2/model-providers', '/v2/notes', '/v2/lines/main', '/v2/client-version']) {
    assert.equal(sensitivePath(path), false, path);
  }
});

test('compressed payload decompresses identically; skips short payloads', () => {
  const text = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `第 ${i} 条笔记` })) });
  const br = compressText(text, 'br');
  const gz = compressText(text, 'gzip');
  assert.ok(br !== null && gz !== null);
  assert.equal(brotliDecompressSync(br.data).toString(), text);
  assert.equal(gunzipSync(gz.data).toString(), text);
  assert.ok(br.data.length < text.length / 3);
  assert.equal(compressText('x'.repeat(MIN_COMPRESS_BYTES - 1), 'br'), null);
  assert.equal(compressText(text, null), null);
});

test('HTTP responses compress for gzip, send raw otherwise, skip auth routes, always set Vary', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const big = await fetch(`${app.base}/v2/soul`, { headers: { cookie, 'accept-encoding': 'gzip' } });
  const raw = await fetch(`${app.base}/v2/soul`, { headers: { cookie, 'accept-encoding': 'identity' } });
  assert.equal(big.status, 200);
  assert.equal(big.headers.get('content-encoding'), 'gzip');
  assert.match(big.headers.get('vary') ?? '', /accept-encoding/i);
  assert.equal(raw.headers.get('content-encoding'), null);
  assert.deepEqual(await big.json(), await raw.json());
  const account = await call(app, 'GET', '/v2/account/state', { cookie, headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(account.headers.get('content-encoding'), null);
});
