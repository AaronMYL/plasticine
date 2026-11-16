// 自定义提供商（11-16）：保存后和内置的平级出现、能真的调用；改的时候 key 不给就沿用、新加的模型启用；
// 删除后选了它的默认和用途回到跟默认走；重启服务（重新装 KernelModels）还在。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { KernelModels, removeCustomProvider, saveCustomProvider, storedCustomKey } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { FAKE_BASE, FAKE_KEY, fakeCompatibleServer } from './fake-compatible-server.ts';
import { fakeProviders } from './helpers.ts';

const opened: TestState[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.cleanup();
});

async function setup() {
  const handle = await openTestState();
  opened.push(handle);
  const kernel = new KernelModels({ state: handle.state, providers: fakeProviders().providers });
  return { kernel, state: handle.state };
}

const MONK = { id: null, name: 'Monk', protocol: 'openai-completions' as const, baseUrl: `${FAKE_BASE}/`,
  apiKey: FAKE_KEY, models: ['monk', 'monk-fast', ' monk ', ''] };

test('保存：排在内置的后面，带地址和协议，不回显 key；填的模型都启用；成了默认可用的模型', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  assert.match(id, /^custom-/);
  const providers = kernel.providers();
  assert.equal(providers.at(-1)?.id, id);
  const monk = providers.at(-1);
  assert.equal(monk?.name, 'Monk');
  assert.equal(monk?.connected, 'api_key');
  assert.deepEqual(monk?.custom, { baseUrl: FAKE_BASE, protocol: 'openai-completions' });
  assert.deepEqual(monk?.models.map((model) => model.id), ['monk', 'monk-fast'], '去空格、去重、去空');
  assert.deepEqual(monk?.enabled, ['monk', 'monk-fast']);
  assert.equal(JSON.stringify(providers).includes(FAKE_KEY), false);
  assert.deepEqual(kernel.effective(), { provider: id, model: 'monk', thinking: 'off' });
});

test('能真的调用：经 pi-ai 按 OpenAI 兼容协议发到填的地址', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  const server = fakeCompatibleServer({ reply: '你好' });
  const model = kernel.models.getModel(id, 'monk-fast');
  assert.ok(model !== undefined);
  const answer = await kernel.models.completeSimple(model,
    { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }, { fetch: server.fetch });
  assert.equal(answer.stopReason, 'stop');
  assert.equal(server.seen[0]?.url, `${FAKE_BASE}/chat/completions`);
  assert.equal(server.seen[0]?.headers['authorization'], `Bearer ${FAKE_KEY}`);
});

test('改：key 不给就沿用；新加的模型启用，关掉的保持关，删掉的不见', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  kernel.configure({ version: kernel.settings().version, purposes: [], enabled: [{ provider: id, models: ['monk'] }] });
  await saveCustomProvider(kernel, state, { id, name: 'Monk 2', protocol: 'openai-completions', baseUrl: FAKE_BASE,
    models: ['monk', 'monk-fast', 'monk-opus'] });
  const monk = kernel.providers().find((item) => item.id === id);
  assert.equal(monk?.name, 'Monk 2');
  assert.deepEqual(monk?.enabled, ['monk', 'monk-opus']);
  assert.equal(await storedCustomKey(kernel, id), FAKE_KEY);
  await saveCustomProvider(kernel, state, { id, name: 'Monk 2', protocol: 'openai-completions', baseUrl: FAKE_BASE,
    apiKey: 'sk-another-fake-key-000', models: ['monk-opus'] });
  assert.equal(await storedCustomKey(kernel, id), 'sk-another-fake-key-000');
  assert.deepEqual(kernel.providers().find((item) => item.id === id)?.models.map((model) => model.id),
    ['monk-opus']);
});

test('不填 key 也能存（本机的模型服务），算已连接', async () => {
  const { kernel, state } = await setup();
  const { apiKey: _apiKey, ...noKey } = MONK;
  const id = await saveCustomProvider(kernel, state, noKey);
  assert.equal(kernel.providers().find((item) => item.id === id)?.connected, 'api_key');
});

test('地址不对、没有模型、改不存在的那家：都回清楚的错', async () => {
  const { kernel, state } = await setup();
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, baseUrl: 'https://' }), /不是一个网址/);
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, models: [' '] }), /至少填一个模型名/);
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, id: 'custom-nope' }), /没有这家/);
  await assert.rejects(removeCustomProvider(kernel, state, 'custom-nope'), /没有这家/);
});

test('删除：这家不见了、key 清掉；选了它的默认和用途回到跟默认走', async () => {
  const { kernel, state } = await setup();
  await kernel.setApiKey('fake-key', 'test-only-key');
  const id = await saveCustomProvider(kernel, state, MONK);
  kernel.configure({ version: kernel.settings().version, default: { provider: id, model: 'monk', thinking: 'off' },
    purposes: [{ purpose: 'translation', chosen: { model: { provider: id, model: 'monk-fast' }, thinking: null } }] });
  await removeCustomProvider(kernel, state, id);
  assert.equal(kernel.providers().some((item) => item.id === id), false);
  assert.equal(kernel.models.getProvider(id), undefined);
  assert.equal(kernel.credentials.connectedType(id), null);
  assert.equal(kernel.chosen(), null);
  const translation = kernel.settings().purposes.find((item) => item.purpose === 'translation');
  assert.equal(translation?.chosen.model, null);
  assert.equal(kernel.effective()?.provider, 'fake-key');
});

test('重启服务后还在：新装的 KernelModels 从库里读回来', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  const again = new KernelModels({ state, providers: fakeProviders().providers });
  assert.equal(again.providers().find((item) => item.id === id)?.name, 'Monk');
  assert.ok(again.models.getModel(id, 'monk') !== undefined);
});
