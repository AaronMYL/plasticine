import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp, newRequestId } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); });

test('direct feed item lookup by ID ignores list filters; 401 unauthenticated, 404 missing', async () => {
  app = await startTestApp();
  const cookie = await pair(app);
  const created = json(await call(app, 'POST', '/v2/feed/items', { cookie,
    body: { requestId: newRequestId('target'), title: '汇报里提到的原条目', summary: '保持原记录' } }));
  const item = created['item'] as { id: string; version: number };
  await call(app, 'POST', `/v2/feed/items/${item.id}/reaction`, { cookie,
    body: { requestId: newRequestId('hide'), version: item.version, reaction: 'dislike' } });
  assert.equal((await call(app, 'GET', `/v2/feed/items/${item.id}`)).status, 401);
  const target = await call(app, 'GET', `/v2/feed/items/${item.id}`, { cookie });
  assert.equal(target.status, 200);
  assert.equal((json(target)['item'] as { id: string }).id, item.id);
  assert.equal((json(target)['item'] as { reaction: string }).reaction, 'dislike');
  assert.equal((await call(app, 'GET', '/v2/feed/items/missing', { cookie })).status, 404);
});
