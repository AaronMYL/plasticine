// /v2/model-providers、/v2/model-default：按提供商通用的模型连接（假提供商，不联网）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MODEL_CONFIG_PATH, MODEL_DEFAULT_PATH, MODEL_PROVIDERS_PATH, TRANSLATE_MODEL_PATH,
  modelProviderPath, providerLoginPath, type ListModelProvidersResponse }
  from '../../shared/api/index.ts';
import { KernelModels, ProviderLogins } from '../../src/kernel/index.ts';
import { FAKE_AUTH_URL, fakeProviders, GOOD_CALLBACK } from '../kernel/helpers.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

let counter = 0;
function requestId(): string {
  counter += 1;
  return `provider-request-${String(counter).padStart(4, '0')}`;
}

async function providerApp() {
  const t = await startTestApp([], { kernelModels: (state) => {
    const models = new KernelModels({ state, providers: fakeProviders().providers });
    return { models, logins: new ProviderLogins(models) };
  } });
  apps.push(t);
  return { t, cookie: await pair(t) };
}

test('没装的服务回 503；没登录 401', async () => {
  const old = await startTestApp();
  apps.push(old);
  assert.equal((await call(old, 'GET', MODEL_PROVIDERS_PATH, { cookie: await pair(old) })).status, 503);
  const { t } = await providerApp();
  assert.equal((await call(t, 'GET', MODEL_PROVIDERS_PATH)).status, 401);
});

test('列提供商（平级）、填 key（响应里没有 key）、选默认模型、退出', async () => {
  const { t, cookie } = await providerApp();
  const listed = json(await call(t, 'GET', MODEL_PROVIDERS_PATH, { cookie }));
  assert.deepEqual((listed['providers'] as { id: string }[]).map((provider) => provider.id), ['fake-sub', 'fake-key']);
  assert.equal(listed['effective'], null);
  const keyed = await call(t, 'POST', `${modelProviderPath('fake-key')}/key`, { cookie,
    body: { requestId: requestId(), apiKey: 'key-value-for-tests' } });
  assert.equal(keyed.status, 200);
  assert.equal(JSON.stringify(keyed.body).includes('key-value-for-tests'), false);
  assert.deepEqual(json(keyed)['effective'], { provider: 'fake-key', model: 'key-model', thinking: 'medium' });
  const chosen = await call(t, 'POST', MODEL_DEFAULT_PATH, { cookie,
    body: { requestId: requestId(), provider: 'fake-key', model: 'key-model', thinking: 'high' } });
  assert.deepEqual(json(chosen)['chosen'], { provider: 'fake-key', model: 'key-model', thinking: 'high' });
  const wrong = await call(t, 'POST', MODEL_DEFAULT_PATH, { cookie,
    body: { requestId: requestId(), provider: 'fake-key', model: 'nope' } });
  assert.equal(wrong.status, 400);
  const missing = await call(t, 'POST', `${modelProviderPath('nope')}/key`, { cookie,
    body: { requestId: requestId(), apiKey: 'x' } });
  assert.equal(missing.status, 404);
  const out = await call(t, 'POST', `${modelProviderPath('fake-key')}/logout`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(json(out)['effective'], null);
});

test('订阅登录走接口：开始拿到原样的授权网址；交回调地址后连上', async () => {
  const { t, cookie } = await providerApp();
  const started = json(await call(t, 'POST', `${modelProviderPath('fake-sub')}/login`, { cookie,
    body: { requestId: requestId() } }));
  assert.equal(started['url'], FAKE_AUTH_URL, '授权网址的参数一个不少');
  assert.equal((started['prompt'] as { type: string }).type, 'manual_code');
  const loginId = String(started['id']);
  const done = await call(t, 'POST', `${providerLoginPath('fake-sub', loginId)}/complete`, { cookie,
    body: { requestId: requestId(), input: GOOD_CALLBACK } });
  assert.equal(done.status, 200);
  let status = '';
  for (let tries = 0; tries < 50 && status !== 'done'; tries += 1) {
    status = String(json(await call(t, 'GET', providerLoginPath('fake-sub', loginId), { cookie }))['status']);
  }
  assert.equal(status, 'done');
  const listed = json(await call(t, 'GET', MODEL_PROVIDERS_PATH, { cookie }));
  assert.equal((listed['providers'] as { connected: string | null }[])[0]?.connected, 'oauth');
  assert.equal(JSON.stringify(listed).includes('access-value-for-tests'), false);
  const notOauth = await call(t, 'POST', `${modelProviderPath('fake-key')}/login`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(notOauth.status, 400);
});

test('翻译模型：读到跟默认走；选一个按版本存；旧版本 409；没有的模型 400', async () => {
  const { t, cookie } = await providerApp();
  await call(t, 'POST', `${modelProviderPath('fake-key')}/key`, { cookie,
    body: { requestId: requestId(), apiKey: 'key-value-for-tests' } });
  const read = json(await call(t, 'GET', TRANSLATE_MODEL_PATH, { cookie }));
  assert.deepEqual(read, { chosen: null, version: 0,
    effective: { provider: 'fake-key', model: 'key-model', thinking: 'medium' } });
  const chosen = { provider: 'fake-key', model: 'key-model', thinking: 'minimal' };
  const saved = await call(t, 'PUT', TRANSLATE_MODEL_PATH, { cookie,
    body: { requestId: requestId(), version: 0, chosen } });
  assert.equal(saved.status, 200);
  assert.deepEqual(json(saved)['effective'], chosen);
  const stale = await call(t, 'PUT', TRANSLATE_MODEL_PATH, { cookie,
    body: { requestId: requestId(), version: 0, chosen: null } });
  assert.equal(stale.status, 409);
  const wrong = await call(t, 'PUT', TRANSLATE_MODEL_PATH, { cookie,
    body: { requestId: requestId(), version: 1, chosen: { ...chosen, model: 'nope' } } });
  assert.equal(wrong.status, 400);
});

test('用途配置接口一次保存、按版本防覆盖并幂等；未知用途与重复用途不会改动配置', async () => {
  const { t, cookie } = await providerApp();
  const read = json(await call(t, 'GET', MODEL_PROVIDERS_PATH, { cookie })) as unknown as ListModelProvidersResponse;
  assert.equal(read.purposes.length, 28);
  assert.ok(read.purposes.some((entry) => entry.purpose === 'web_extract'));
  assert.ok(read.providers.every((item) => Array.isArray(item.enabled)));
  const body = { requestId: requestId(), version: read.version,
    enabled: [{ provider: 'fake-key', models: ['key-model'] }], purposes: [
    { purpose: 'main', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
    { purpose: 'translation', chosen: { model: null, thinking: 'high' } },
  ] };
  const saved = await call(t, 'POST', MODEL_CONFIG_PATH, { cookie, body });
  assert.equal(saved.status, 200);
  assert.equal(json(saved)['chosen'], null, '用途设置没有改全局默认');
  const replay = await call(t, 'POST', MODEL_CONFIG_PATH, { cookie, body });
  assert.deepEqual(replay.body, saved.body);
  const stale = await call(t, 'POST', MODEL_CONFIG_PATH, { cookie, body: { ...body, requestId: requestId() } });
  assert.equal(stale.status, 409);
  for (const purposes of [
    [{ purpose: 'invented', chosen: { model: null, thinking: null } }],
    [body.purposes[0], body.purposes[0]],
  ]) {
    const invalid = await call(t, 'POST', MODEL_CONFIG_PATH, { cookie,
      body: { requestId: requestId(), version: read.version + 1, purposes } });
    assert.equal(invalid.status, 400);
  }
  const after = await call(t, 'GET', MODEL_PROVIDERS_PATH, { cookie });
  assert.equal(json(after)['version'], read.version + 1);
  const listed = json(after) as unknown as ListModelProvidersResponse;
  assert.deepEqual(listed.providers.find((item) => item.id === 'fake-key')?.enabled, ['key-model']);
});
