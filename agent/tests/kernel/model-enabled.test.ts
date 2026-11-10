// 《优化清单》第 13 条：每家启用哪几个模型、新用途（旁聊、心跳、做梦、回顾、研究员）、选的模型后来用不了时回到默认。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { clampToLevels, MODEL_PURPOSES, THINKING_LEVELS } from '../../shared/api/index.ts';
import { KernelModelError, KernelModels } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { fakeProviders } from './helpers.ts';

const opened: TestState[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.cleanup();
});

async function setup(options: { prices?: Record<string, number> } = {}) {
  const handle = await openTestState();
  opened.push(handle);
  const fakes = fakeProviders();
  const kernel = new KernelModels({ state: handle.state, providers: fakes.providers });
  for (const [id, price] of Object.entries(options.prices ?? {})) {
    const [provider, model] = id.split('/');
    const found = kernel.models.getModel(provider ?? '', model ?? '');
    assert.ok(found !== undefined);
    found.cost = { input: price, output: price, cacheRead: 0, cacheWrite: 0 };
  }
  await kernel.setApiKey('fake-sub', 'test-sub-key');
  await kernel.setApiKey('fake-key', 'test-only-key');
  return { kernel, state: handle.state };
}

function enabledOf(kernel: KernelModels, provider: string): string[] | undefined {
  return kernel.providers().find((item) => item.id === provider)?.enabled;
}

function issueOf(kernel: KernelModels, purpose: string): string | null | undefined {
  return kernel.settings().purposes.find((item) => item.purpose === purpose)?.issue;
}

test('登记了旁聊、心跳、做梦、回顾、研究员、视频解析，共 28 个用途', () => {
  const ids = MODEL_PURPOSES.map((item) => item.id);
  for (const id of ['side', 'heartbeat', 'dream', 'review', 'researcher']) {
    assert.ok((ids as string[]).includes(id), id);
  }
  assert.equal(ids.length, 28);
  assert.equal(new Set(ids).size, ids.length);
});

test('没设过启用集合：默认启用这家现在被用到的模型，升级后原配置照常可用', async () => {
  const { kernel, state } = await setup();
  // 升级前的配置：默认选了 sub-large，翻译单独选了 key-model；没有 enabled。
  state.kernelSettings.set('model_purposes', { version: 3,
    default: { provider: 'fake-sub', model: 'sub-large', thinking: 'high' },
    overrides: { translation: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } } });
  assert.deepEqual(enabledOf(kernel, 'fake-sub'), ['sub-large']);
  assert.deepEqual(enabledOf(kernel, 'fake-key'), ['key-model']);
  assert.deepEqual(kernel.effective('translation'), { provider: 'fake-key', model: 'key-model', thinking: 'high' });
  assert.deepEqual(kernel.effective('main'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
  assert.equal(issueOf(kernel, 'translation'), null);
});

test('什么都没选过：以前退到的第一家第一个模型算被用到，照常可用', async () => {
  const { kernel } = await setup();
  assert.deepEqual(enabledOf(kernel, 'fake-sub'), ['sub-large']);
  assert.deepEqual(enabledOf(kernel, 'fake-key'), []);
  assert.equal(kernel.effective()?.model, 'sub-large');
});

test('改别的设置时冻结没设过的那几家：换默认后原来用到的模型仍启用', async () => {
  const { kernel } = await setup();
  kernel.setDefault({ provider: 'fake-sub', model: 'sub-large', thinking: 'medium' });
  kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] }] });
  kernel.setDefault({ provider: 'fake-sub', model: 'sub-small', thinking: 'medium' });
  assert.deepEqual(enabledOf(kernel, 'fake-sub'), ['sub-large', 'sub-small']);
});

test('启用集合整份换掉、照目录顺序；未知模型或没启用的模型不能选', async () => {
  const { kernel } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: 'fake-sub', models: ['sub-small', 'sub-large'] }] });
  assert.deepEqual(enabledOf(kernel, 'fake-sub'), ['sub-large', 'sub-small']);
  assert.throws(() => kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: 'fake-sub', models: ['nope'] }] }),
  (error: unknown) => error instanceof KernelModelError && error.code === 'invalid');
  assert.throws(() => kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'agent', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
  ] }), /启用/);
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'agent', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
  ], enabled: [{ provider: 'fake-key', models: ['key-model'] }] });
  assert.equal(kernel.effective('agent')?.model, 'key-model');
});

test('选的模型后来取消启用：这个用途回到默认，那一行写原因；重新启用就回来', async () => {
  const { kernel } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'agent', chosen: { model: { provider: 'fake-sub', model: 'sub-small' }, thinking: 'high' } },
  ], default: { provider: 'fake-sub', model: 'sub-large', thinking: 'low' },
  enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] }] });
  assert.equal(kernel.effective('agent')?.model, 'sub-small');
  kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: 'fake-sub', models: ['sub-large'] }] });
  assert.deepEqual(kernel.effective('agent'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
  assert.equal(issueOf(kernel, 'agent'), 'sub-small 已取消启用，回到默认。');
  assert.equal(issueOf(kernel, 'main'), null);
  kernel.configure({ version: kernel.settings().version, purposes: [],
    enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] }] });
  assert.equal(kernel.effective('agent')?.model, 'sub-small');
  assert.equal(issueOf(kernel, 'agent'), null);
});

test('选的那家断开：用途回到默认，写哪家断开了', async () => {
  const { kernel } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'translation', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
  ], default: { provider: 'fake-sub', model: 'sub-large', thinking: 'medium' },
  enabled: [{ provider: 'fake-key', models: ['key-model'] }] });
  await kernel.logout('fake-key');
  assert.equal(kernel.effective('translation')?.model, 'sub-large');
  assert.equal(issueOf(kernel, 'translation'), 'Fake Key 已断开，回到默认。');
});

test('旁聊默认跟主线；单独设了就和主线分开', async () => {
  const { kernel } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'main', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' } },
  ], enabled: [{ provider: 'fake-key', models: ['key-model'] }] });
  assert.deepEqual(kernel.effective('side'), { provider: 'fake-key', model: 'key-model', thinking: 'high' });
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'side', chosen: { model: { provider: 'fake-sub', model: 'sub-large' }, thinking: null } },
  ] });
  assert.deepEqual(kernel.effective('side'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
  assert.equal(kernel.effective('main')?.model, 'key-model');
});

test('心跳、做梦默认用默认那一家里已启用的最便宜的模型、低档；看不出价钱就跟默认', async () => {
  const { kernel } = await setup({ prices: { 'fake-sub/sub-large': 10, 'fake-sub/sub-small': 1,
    'fake-key/key-model': 0.1 } });
  kernel.configure({ version: kernel.settings().version, purposes: [],
    default: { provider: 'fake-sub', model: 'sub-large', thinking: 'high' },
    enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] },
      { provider: 'fake-key', models: ['key-model'] }] });
  assert.deepEqual(kernel.effective('heartbeat'), { provider: 'fake-sub', model: 'sub-small', thinking: 'low' });
  assert.deepEqual(kernel.effective('dream'), { provider: 'fake-sub', model: 'sub-small', thinking: 'low' });
  assert.deepEqual(kernel.effective('review'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'dream', chosen: { model: null, thinking: 'high' } },
  ] });
  assert.deepEqual(kernel.effective('dream'), { provider: 'fake-sub', model: 'sub-small', thinking: 'high' });
});

test('心跳：目录里没有价钱时跟默认', async () => {
  const { kernel } = await setup({ prices: { 'fake-sub/sub-large': 0, 'fake-sub/sub-small': 0 } });
  kernel.configure({ version: kernel.settings().version, purposes: [],
    default: { provider: 'fake-sub', model: 'sub-large', thinking: 'high' },
    enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] }] });
  assert.deepEqual(kernel.effective('heartbeat'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
});

test('列表里每家带启用集合；思考夹档和 pi 的 clampThinkingLevel 一致', async () => {
  const { kernel } = await setup();
  const model = kernel.models.getModel('fake-key', 'key-model');
  assert.ok(model !== undefined);
  for (const map of [{}, { minimal: null, xhigh: null, max: null }, { off: null, low: null }, { xhigh: 'high' }]) {
    model.thinkingLevelMap = map;
    for (const level of THINKING_LEVELS) {
      assert.equal(clampToLevels(getSupportedThinkingLevels(model), level), clampThinkingLevel(model, level),
        `${JSON.stringify(map)} ${level}`);
    }
  }
});
