import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientVersionOf, type ClientUpdatesResponse } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

function manyAssets(count: number): ClientUpdatesResponse['updates'][number]['manifest']['assets'] {
  return Array.from({ length: count }, (_, index) => ({
    path: `assets/chunk-${index}.js`,
    bytes: 1_000 + index,
    sha256: index.toString(16).padStart(64, '0'),
  }));
}

test('查新版本只回版本号、时间、接口版本和一句说明，不带资源清单', () => {
  const view: ClientUpdatesResponse = {
    current: {
      buildId: 'build-2026-11-12',
      builtAt: '2026-11-12T08:58:36.000Z',
      protocol: { min: 2, max: 2 },
      summary: '网页版本更新',
      assets: manyAssets(900),
    },
    updates: [],
    history: [],
    channelReady: false,
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

test('没有部署清单时也是同一个形状；出错只回一句', () => {
  const view: ClientUpdatesResponse = { current: null, updates: [], history: [], channelReady: false,
    error: '客户端发布记录校验失败，请检查部署清单。' };
  assert.deepEqual(clientVersionOf(view), { current: null, error: '客户端发布记录校验失败，请检查部署清单。' });
});

test('GET /v2/client-version 回小形状，不再带发布历史和候选', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const reply = await call(app, 'GET', '/v2/client-version', { cookie });
  assert.equal(reply.status, 200);
  assert.deepEqual(json(reply), { current: null, error: null });
  assert.equal(reply.headers.get('cache-control'), 'no-store');
});
