import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientVersionOf, type ClientManifest } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

function manyAssets(count: number): ClientManifest['assets'] {
  return Array.from({ length: count }, (_, index) => ({
    path: `assets/chunk-${index}.js`,
    bytes: 1_000 + index,
    sha256: index.toString(16).padStart(64, '0'),
  }));
}

test('version check returns version, timestamp, API version, and summary without asset manifest', () => {
  const view: { current: ClientManifest; error: null } = {
    current: {
      buildId: 'build-2026-11-12',
      builtAt: '2026-11-12T08:58:36.000Z',
      protocol: { min: 2, max: 2 },
      summary: '网页版本更新',
      assets: manyAssets(900),
    },
    error: null,
  };
  const slim = clientVersionOf(view);
  assert.deepEqual(slim, {
    current: {
      buildId: 'build-2026-11-12',
      builtAt: '2026-11-12T08:58:36.000Z',
      protocol: { min: 2, max: 2 },
      summary: '网页版本更新',
    },
    error: null,
  });
  assert.ok(JSON.stringify(slim).length < 300);
  assert.ok(JSON.stringify(view).length > 100_000);
});

test('missing deploy manifest returns same shape; errors return only a single message', () => {
  const view = { current: null, error: '客户端发布记录校验失败，请检查部署清单。' };
  assert.deepEqual(clientVersionOf(view), { current: null, error: '客户端发布记录校验失败，请检查部署清单。' });
});

test('GET /v2/client-version returns compact shape without release history or candidates', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const reply = await call(app, 'GET', '/v2/client-version', { cookie });
  assert.equal(reply.status, 200);
  assert.deepEqual(json(reply), { current: null, error: null });
  assert.equal(reply.headers.get('cache-control'), 'no-store');
});

test('legacy self-iteration release endpoints removed: candidates, proposals, previews return 404', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const gone = ['/v2/self/client-updates', '/v2/client-preview/build-1', '/v2/client-preview/build-1/assets/a.js'];
  for (const path of gone) {
    assert.equal((await call(app, 'GET', path, { cookie })).status, 404, path);
  }
  assert.equal((await call(app, 'POST', '/v2/self/client-updates/build-1/decision', { cookie })).status, 404);
});
