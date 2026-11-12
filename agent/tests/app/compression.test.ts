import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compressText, MIN_COMPRESS_BYTES, pickEncoding, sensitivePath } from '../../src/app/compression.ts';
import { call, pair, startTestApp } from './helpers.ts';

test('按 Accept-Encoding 挑编码：先 br 再 gzip，q=0 算不收', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding(['gzip', 'br']), 'br');
});

test('登录、账号、模型登录这类接口不压', () => {
  for (const path of ['/v2/session/password', '/v2/session/local', '/v2/account', '/v2/account/setup',
    '/v2/model-providers/openai-codex/login', '/v2/model-providers/openai-codex/login/callback']) {
    assert.equal(sensitivePath(path), true, path);
  }
  for (const path of ['/v2/model-providers', '/v2/notes', '/v2/lines/main', '/v2/client-version']) {
    assert.equal(sensitivePath(path), false, path);
  }
});

test('压出来的能原样解开；太短的不压', () => {
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

test('接口回应：收 gzip 的压、不收的原样、登录类不压，都带 Vary', async (t) => {
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
