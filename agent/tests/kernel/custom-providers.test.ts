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

function entry(id: string, extra: Partial<{ reasoning: boolean; images: boolean; contextWindow: number }> = {}) {
  return { id, reasoning: false, images: true, contextWindow: 128_000, ...extra };
}

const MONK = { id: null, name: 'Monk', protocol: 'openai-completions' as const, baseUrl: `${FAKE_BASE}/`,
  apiKey: FAKE_KEY, models: [entry('monk'), entry('monk-fast'), entry(' monk ', { reasoning: true }), entry(' ')] };

test('saved custom provider appears after built-ins, hides key, enables models as default options', async () => {
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

test('custom provider invokes real OpenAI-compatible endpoint through pi-ai', async () => {
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

test('edit preserves omitted key, enables new models, keeps disabled off, drops removed', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  kernel.configure({ version: kernel.settings().version, purposes: [], enabled: [{ provider: id, models: ['monk'] }] });
  await saveCustomProvider(kernel, state, { id, name: 'Monk 2', protocol: 'openai-completions', baseUrl: FAKE_BASE,
    models: [entry('monk'), entry('monk-fast'), entry('monk-opus')] });
  const monk = kernel.providers().find((item) => item.id === id);
  assert.equal(monk?.name, 'Monk 2');
  assert.deepEqual(monk?.enabled, ['monk', 'monk-opus']);
  assert.equal(await storedCustomKey(kernel, id), FAKE_KEY);
  await saveCustomProvider(kernel, state, { id, name: 'Monk 2', protocol: 'openai-completions', baseUrl: FAKE_BASE,
    apiKey: 'sk-another-fake-key-000', models: [entry('monk-opus')] });
  assert.equal(await storedCustomKey(kernel, id), 'sk-another-fake-key-000');
  assert.deepEqual(kernel.providers().find((item) => item.id === id)?.models.map((model) => model.id),
    ['monk-opus']);
});

test('local model server saves without API key and counts as connected', async () => {
  const { kernel, state } = await setup();
  const { apiKey: _apiKey, ...noKey } = MONK;
  const id = await saveCustomProvider(kernel, state, noKey);
  assert.equal(kernel.providers().find((item) => item.id === id)?.connected, 'api_key');
});

test('bad URL, empty models, or editing missing provider returns clear error', async () => {
  const { kernel, state } = await setup();
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, baseUrl: 'https://' }), /不是一个网址/);
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, models: [entry(' ')] }), /至少填一个模型名/);
  await assert.rejects(saveCustomProvider(kernel, state, { ...MONK, id: 'custom-nope' }), /没有这家/);
  await assert.rejects(removeCustomProvider(kernel, state, 'custom-nope'), /没有这家/);
});

test('deleting custom provider clears key and falls back defaults/purposes to default', async () => {
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

test('saved custom providers reload from DB into KernelModels after service restart', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, MONK);
  const again = new KernelModels({ state, providers: fakeProviders().providers });
  assert.equal(again.providers().find((item) => item.id === id)?.name, 'Monk');
  assert.ok(again.models.getModel(id, 'monk') !== undefined);
});

test('per-model capabilities set thinking levels, text-only for non-vision, and custom context', async () => {
  const { kernel, state } = await setup();
  const id = await saveCustomProvider(kernel, state, { ...MONK, models: [entry('monk-opus',
    { reasoning: true, contextWindow: 200_000 }), entry('monk-fast', { images: false, contextWindow: 32_000 })] });
  const models = kernel.providers().find((item) => item.id === id)?.models;
  assert.deepEqual(models?.map((model) => [model.id, model.reasoning, model.thinkingLevels, model.input,
    model.contextWindow]), [
    ['monk-opus', true, ['off', 'low', 'medium', 'high'], ['text', 'image'], 200_000],
    ['monk-fast', false, ['off'], ['text'], 32_000],
  ]);
  assert.equal(kernel.models.getModel(id, 'monk-fast')?.maxTokens, 16_000, '上下文短的一次最多写一半');
  const server = fakeCompatibleServer({ models: ['monk-opus'] });
  const opus = kernel.models.getModel(id, 'monk-opus');
  assert.ok(opus !== undefined);
  await kernel.models.completeSimple(opus, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
    { fetch: server.fetch, reasoning: 'high' });
  assert.equal((server.seen[0]?.body as Record<string, unknown>)['reasoning_effort'], 'high');
});

test('migrates v1 model-name-only entries into full structured format on KernelModels load', async () => {
  const { state } = await setup();
  state.kernelSettings.set('custom_providers', [{ id: 'custom-old00001', name: 'Old', protocol: 'openai-completions',
    baseUrl: FAKE_BASE, models: ['monk', 'monk-fast'] }]);
  const kernel = new KernelModels({ state, providers: fakeProviders().providers });
  assert.deepEqual(state.kernelSettings.get('custom_providers'), [{ id: 'custom-old00001', name: 'Old',
    protocol: 'openai-completions', baseUrl: FAKE_BASE, models: [entry('monk'), entry('monk-fast')] }]);
  assert.ok(kernel.models.getModel('custom-old00001', 'monk') !== undefined);
});
