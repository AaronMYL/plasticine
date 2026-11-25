import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { WebSearchStatusSchema, WebSearchTestResponseSchema } from '../../shared/api/index.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('web search API key is write-only; test reports clearly when key is unset', async () => {
  t = await startTestApp([], { startTasks: false });
  assert.equal((await call(t, 'GET', '/v2/settings/web-search')).status, 401);
  const cookie = await pair(t);
  const before = Value.Parse(WebSearchStatusSchema, (await call(t, 'GET', '/v2/settings/web-search', { cookie })).body);
  assert.equal(before.configured, false);
  const tested = Value.Parse(WebSearchTestResponseSchema, (await call(t, 'POST', '/v2/settings/web-search/test',
    { cookie, body: { requestId: 'search-test-0001' } })).body);
  assert.deepEqual([tested.ok, tested.error], [false, '还没填密钥。']);
  const saved = await call(t, 'PUT', '/v2/settings/web-search', { cookie,
    body: { requestId: 'search-save-0001', provider: 'tavily', apiKey: 'tvly-example-key-1234' } });
  assert.equal(saved.status, 200);
  assert.ok(!JSON.stringify(saved.body).includes('tvly-example-key-1234'));
  assert.equal(Value.Parse(WebSearchStatusSchema, saved.body).keyHint, '…1234');
  const cleared = await call(t, 'PUT', '/v2/settings/web-search', { cookie,
    body: { requestId: 'search-save-0002', provider: 'tavily', apiKey: null } });
  assert.equal(Value.Parse(WebSearchStatusSchema, cleared.body).configured, false);
});
