// 设置 · 网络搜索（11-16）：没登录 401；填了密钥只回末尾几位；没填时测试说清楚；清掉回到没填。

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

test('网络搜索的密钥：只写不读，测试没填时说清楚', async () => {
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
