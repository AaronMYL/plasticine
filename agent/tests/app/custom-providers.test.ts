import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CUSTOM_PROVIDERS_PATH, customProviderRemovePath, MODEL_CONNECTION_TEST_PATH, MODEL_PROVIDERS_PATH,
  type ModelProviderView } from '../../shared/api/index.ts';
import { KernelModels, ProviderLogins } from '../../src/kernel/index.ts';
import { FAKE_BASE, FAKE_KEY, fakeCompatibleServer } from '../kernel/fake-compatible-server.ts';
import { fakeProviders } from '../kernel/helpers.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

let counter = 0;
function requestId(): string {
  counter += 1;
  return `custom-request-${String(counter).padStart(4, '0')}`;
}

async function customApp() {
  const server = fakeCompatibleServer({ models: ['monk', 'monk-fast', 'monk-coding', 'monk-free', 'monk-opus'] });
  const t = await startTestApp([], { kernelModels: (state) => {
    const models = new KernelModels({ state, providers: fakeProviders().providers });
    return { models, logins: new ProviderLogins(models), connectionTest: { fetch: server.fetch } };
  } });
  apps.push(t);
  return { t, cookie: await pair(t), server };
}

function custom(body: unknown): ModelProviderView | undefined {
  const providers = (body as { providers: ModelProviderView[] }).providers;
  return providers.find((item) => item.custom !== null);
}

const entry = (id: string) => ({ id, reasoning: false, images: true, contextWindow: 128_000 });
const SAVE = { id: null, name: 'Monk', protocol: 'openai-completions', baseUrl: FAKE_BASE, apiKey: FAKE_KEY,
  models: ['monk', 'monk-fast', 'monk-coding', 'monk-free', 'monk-opus'].map(entry) };

test('custom providers: save, list (hiding key), delete; 401 unauthenticated', async () => {
  const { t, cookie } = await customApp();
  assert.equal((await call(t, 'POST', CUSTOM_PROVIDERS_PATH, { body: { requestId: requestId(), ...SAVE } })).status,
    401);
  const saved = await call(t, 'POST', CUSTOM_PROVIDERS_PATH, { cookie, body: { requestId: requestId(), ...SAVE } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.stringify(saved.body).includes(FAKE_KEY), false);
  const monk = custom(saved.body);
  assert.equal(monk?.name, 'Monk');
  assert.equal(monk?.enabled.length, 5);
  const listed = json(await call(t, 'GET', MODEL_PROVIDERS_PATH, { cookie }));
  assert.equal(custom(listed)?.id, monk?.id);
  const removed = await call(t, 'POST', customProviderRemovePath(String(monk?.id)), { cookie,
    body: { requestId: requestId() } });
  assert.equal(removed.status, 200);
  assert.equal(custom(removed.body), undefined);
});

test('invalid custom provider form returns 400: unknown protocol, non-http(s) URL, empty model', async () => {
  const { t, cookie } = await customApp();
  for (const wrong of [{ protocol: 'grpc' }, { baseUrl: 'ftp://example.com' }, { models: [] }, { models: ['monk'] },
    { models: [{ ...entry('monk'), contextWindow: 10 }] }]) {
    const reply = await call(t, 'POST', CUSTOM_PROVIDERS_PATH, { cookie,
      body: { requestId: requestId(), ...SAVE, ...wrong } });
    assert.equal(reply.status, 400, JSON.stringify(wrong));
  }
});

test('test connection uses form key, or falls back to stored key for saved provider', async () => {
  const { t, cookie, server } = await customApp();
  const fresh = json(await call(t, 'POST', MODEL_CONNECTION_TEST_PATH, { cookie, body: { requestId: requestId(),
    providerId: null, protocol: 'openai-completions', baseUrl: FAKE_BASE, apiKey: FAKE_KEY,
    models: [entry('monk-opus')] } }));
  assert.equal(fresh['ok'], true);
  assert.equal((fresh['models'] as string[]).length, 5);
  const saved = await call(t, 'POST', CUSTOM_PROVIDERS_PATH, { cookie, body: { requestId: requestId(), ...SAVE } });
  const id = custom(saved.body)?.id ?? null;
  server.seen.splice(0);
  const reused = json(await call(t, 'POST', MODEL_CONNECTION_TEST_PATH, { cookie, body: { requestId: requestId(),
    providerId: id, protocol: 'openai-completions', baseUrl: FAKE_BASE, models: [entry('monk')] } }));
  assert.equal(reused['ok'], true);
  assert.equal(server.seen[0]?.headers['authorization'], `Bearer ${FAKE_KEY}`);
  assert.equal(JSON.stringify(reused).includes(FAKE_KEY), false);
});

test('failed connection test returns per-step status and raw server message', async () => {
  const { t, cookie } = await customApp();
  const result = json(await call(t, 'POST', MODEL_CONNECTION_TEST_PATH, { cookie, body: { requestId: requestId(),
    providerId: null, protocol: 'openai-completions', baseUrl: FAKE_BASE, apiKey: FAKE_KEY,
    models: [{ ...entry('monk-x'), images: false }] } }));
  assert.equal(result['ok'], false);
  const steps = result['steps'] as { summary: string; detail: string | null }[];
  assert.equal(steps[1]?.summary, '模型名不对：接口说没有「monk-x」（404）');
  assert.match(steps[1]?.detail ?? '', /does not exist/);
});
