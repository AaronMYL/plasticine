import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { KernelModelError, KernelModels, ProviderLogins, SqliteCredentialStore, TranslateModel }
  from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { FAKE_AUTH_URL, fakeProviders, GOOD_CALLBACK, pickingProvider } from './helpers.ts';

const opened: TestState[] = [];

async function fresh(): Promise<TestState> {
  const handle = await openTestState();
  opened.push(handle);
  return handle;
}

afterEach(async () => {
  for (const handle of opened.splice(0)) {
    await handle.cleanup();
  }
});

test('DB credentials serialize read-modify-write per provider; list exposes only provider and type', async () => {
  const { state } = await fresh();
  const store = new SqliteCredentialStore(state);
  const seen: (string | undefined)[] = [];
  const slow = store.modify('p', async (current) => {
    seen.push(current?.type);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { type: 'api_key', key: 'first-value' };
  });
  const next = store.modify('p', async (current) => {
    seen.push(current?.type === 'api_key' ? current.key : undefined);
    return { type: 'api_key', key: 'second-value' };
  });
  await Promise.all([slow, next]);
  assert.deepEqual(seen, [undefined, 'first-value']);
  assert.deepEqual(await store.list(), [{ providerId: 'p', type: 'api_key' }]);
  assert.equal(JSON.stringify(await store.list()).includes('second-value'), false);
  await store.modify('p', async () => {
    throw new Error('这次没写成');
  }).catch((error: unknown) => assert.ok(error instanceof Error));
  assert.equal((await store.read('p'))?.type, 'api_key', '失败的那次不动已有的');
  await store.delete('p');
  assert.equal(await store.read('p'), undefined);
});

test('flat provider list shows connection methods; write-only key makes model available to lines', async () => {
  const { state } = await fresh();
  const fakes = fakeProviders();
  const kernel = new KernelModels({ state, providers: fakes.providers });
  const listed = kernel.providers();
  assert.deepEqual(listed.map((provider) => [provider.id, provider.methods, provider.connected]),
    [['fake-sub', ['oauth', 'api_key'], null], ['fake-key', ['api_key'], null]]);
  assert.equal(listed[0]?.loginLabel, '用 Fake 订阅登录');
  assert.equal(kernel.current(), undefined, '一家都没连');
  await kernel.setApiKey('fake-key', '  key-value-for-tests  ');
  assert.equal(JSON.stringify(kernel.providers()).includes('key-value-for-tests'), false);
  assert.equal(kernel.providers()[1]?.connected, 'api_key');
  assert.deepEqual(kernel.effective(), { provider: 'fake-key', model: 'key-model', thinking: 'medium' });
  fakes.keyOnly.appendResponses([fauxAssistantMessage('连上了。')]);
  const choice = kernel.current();
  assert.ok(choice !== undefined);
  const reply = await kernel.complete(choice.model, { messages: [{ role: 'user', content: '在吗', timestamp: 1 }] });
  assert.equal(reply.stopReason, 'stop');
  await assert.rejects(kernel.setApiKey('nope', 'x'),
    (error: unknown) => error instanceof KernelModelError && error.code === 'not_found');
});

test('legacy Codex login displays as ChatGPT (Codex) distinct from Sign in with ChatGPT', async () => {
  const { state } = await fresh();
  const codex = fauxProvider({ provider: 'openai-codex', models: [{ id: 'codex-model', contextWindow: 100_000 }] });
  const kernel = new KernelModels({ state, providers: [{ ...codex.provider, name: 'OpenAI Codex (legacy)' }] });
  assert.deepEqual(kernel.providers().map((provider) => provider.name), ['ChatGPT（Codex）']);
});

test('default model uses selected if connected, else falls back to first connected; rejects unknown', async () => {
  const { state } = await fresh();
  const kernel = new KernelModels({ state, providers: fakeProviders().providers });
  kernel.setDefault({ provider: 'fake-sub', model: 'sub-small', thinking: 'high' });
  assert.deepEqual(kernel.chosen(), { provider: 'fake-sub', model: 'sub-small', thinking: 'high' });
  assert.equal(kernel.effective(), null, '选了但还没连');
  await kernel.setApiKey('fake-key', 'key-value-for-tests');
  assert.deepEqual(kernel.effective(), { provider: 'fake-key', model: 'key-model', thinking: 'high' });
  await kernel.setApiKey('fake-sub', 'sub-key-for-tests');
  assert.deepEqual(kernel.effective(), { provider: 'fake-sub', model: 'sub-small', thinking: 'high' });
  assert.throws(() => kernel.setDefault({ provider: 'fake-sub', model: 'nope' }),
    (error: unknown) => error instanceof KernelModelError && error.code === 'invalid');
  await kernel.logout('fake-sub');
  assert.equal(kernel.providers()[0]?.connected, null);
  assert.equal(kernel.effective()?.provider, 'fake-key');
});

test('translate model inherits default, falls back if disconnected, rejects stale, null resets', async () => {
  const { state } = await fresh();
  const kernel = new KernelModels({ state, providers: fakeProviders().providers });
  const translate = new TranslateModel(kernel, state);
  await kernel.setApiKey('fake-key', 'key-value-for-tests');
  assert.deepEqual(translate.view(), { chosen: null, version: 0,
    effective: { provider: 'fake-key', model: 'key-model', thinking: 'medium' } });
  const saved = translate.choose({ provider: 'fake-sub', model: 'sub-small', thinking: 'minimal' }, 0);
  assert.equal(saved.version, 1);
  assert.equal(saved.effective?.provider, 'fake-key', '选的那家还没连：退回默认模型');
  await kernel.setApiKey('fake-sub', 'sub-key-for-tests');
  assert.deepEqual(translate.view().effective, { provider: 'fake-sub', model: 'sub-small', thinking: 'minimal' });
  assert.equal(translate.source().current()?.model.id, 'sub-small');
  assert.throws(() => translate.choose(null, 0),
    (error: unknown) => error instanceof KernelModelError && error.code === 'conflict');
  assert.throws(() => translate.choose({ provider: 'fake-sub', model: 'nope', thinking: 'low' }, 1),
    (error: unknown) => error instanceof KernelModelError && error.code === 'invalid');
  assert.equal(translate.choose(null, 1).chosen, null);
  assert.equal(translate.view().effective?.thinking, 'medium');
});

test('connected provider shows account/plan from sub token or last 4 chars of API key', async () => {
  const { state } = await fresh();
  const kernel = new KernelModels({ state, providers: fakeProviders().providers });
  const claims = { 'https://api.openai.com/profile': { email: 'me@example.test' },
    'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } };
  const token = ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
  await kernel.credentials.modify('fake-sub', async () => ({ type: 'oauth', access: token, refresh: 'r',
    expires: Date.now() + 60_000 }));
  await kernel.setApiKey('fake-key', 'key-value-for-tests-9z8y');
  const [sub, key] = kernel.providers();
  assert.deepEqual([sub?.account, sub?.plan, sub?.keyLast4], ['me@example.test', 'plus', null]);
  assert.deepEqual([key?.account, key?.plan, key?.keyLast4], [null, null, '9z8y']);
  assert.equal(JSON.stringify(kernel.providers()).includes('key-value-for-tests'), false);
});

test('device UUID generates once on first use, persists in DB, and stays stable', async () => {
  const handle = await fresh();
  const first = new KernelModels({ state: handle.state, providers: fakeProviders().providers }).deviceId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(new KernelModels({ state: handle.state, providers: fakeProviders().providers }).deviceId(), first);
});

test('sub OAuth start returns auth URL and prompt; submitting callback stores hidden creds', async () => {
  const { state } = await fresh();
  const fakes = fakeProviders();
  const kernel = new KernelModels({ state, providers: fakes.providers });
  const logins = new ProviderLogins(kernel);
  const started = await logins.start('fake-sub');
  assert.equal(started.status, 'waiting');
  assert.equal(started.url, FAKE_AUTH_URL);
  assert.equal(started.prompt?.type, 'manual_code');
  assert.deepEqual(fakes.deviceIds, [kernel.deviceId()]);
  logins.complete(started.id, GOOD_CALLBACK);
  for (let tries = 0; tries < 50 && logins.get(started.id).status === 'waiting'; tries += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(logins.get(started.id).status, 'done');
  assert.equal(kernel.providers()[0]?.connected, 'oauth');
  assert.equal(JSON.stringify(kernel.providers()).includes('access-value-for-tests'), false);
  assert.equal(kernel.effective()?.provider, 'fake-sub');
  logins.stop();
});

test('sub OAuth picks browser path when flow asks method (like Codex) and accepts callback URL', async () => {
  const { state } = await fresh();
  const kernel = new KernelModels({ state, providers: [...fakeProviders().providers, pickingProvider()] });
  const logins = new ProviderLogins(kernel);
  const started = await logins.start('fake-pick');
  assert.equal(started.status, 'waiting');
  assert.equal(started.url, FAKE_AUTH_URL);
  assert.equal(started.prompt?.type, 'manual_code');
  logins.complete(started.id, GOOD_CALLBACK);
  for (let tries = 0; tries < 50 && logins.get(started.id).status === 'waiting'; tries += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(logins.get(started.id).status, 'done');
  assert.equal(kernel.providers().find((provider) => provider.id === 'fake-pick')?.connected, 'oauth');
  logins.stop();
});

test('sub OAuth reports clear errors on bad callback, cancel, or unsupported provider', async () => {
  const { state } = await fresh();
  const kernel = new KernelModels({ state, providers: fakeProviders().providers });
  const logins = new ProviderLogins(kernel);
  const wrong = await logins.start('fake-sub');
  logins.complete(wrong.id, 'http://127.0.0.1:1455/auth/callback?error=denied');
  for (let tries = 0; tries < 50 && logins.get(wrong.id).status === 'waiting'; tries += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(logins.get(wrong.id).status, 'failed');
  assert.equal(logins.get(wrong.id).error, '回调地址里没有授权码');
  assert.equal(kernel.providers()[0]?.connected, null);
  const again = await logins.start('fake-sub');
  assert.equal(logins.cancel(again.id).status, 'cancelled');
  assert.throws(() => logins.complete(again.id, GOOD_CALLBACK), KernelModelError);
  await assert.rejects(logins.start('fake-key'),
    (error: unknown) => error instanceof KernelModelError && error.code === 'invalid');
  logins.stop();
});
