// 自动拉型号清单（11-18 Aaron 定）：问订阅账号能用哪些型号，pi-ai 目录里没有的照同系列旧型号补上、标估价；
// 目录里有的一律用目录的；存进库，重启后不联网也在。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { baseFor, estimate, modelName, parseListed } from '../../src/kernel/account-models.ts';
import { KernelModels } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const opened: TestState[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.cleanup();
});

/** 线上 /v1/models 回的格式（11-18 实测，只留用得到的字段）。 */
const LISTED = { models: [
  { slug: 'gpt-9.9-astra', display_name: 'GPT-9.9-Astra', context_window: 400_000, visibility: 'list' },
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', context_window: 272_000, visibility: 'list' },
  { slug: 'gpt-reserve', display_name: 'GPT-Reserve', context_window: 272_000, visibility: 'hide' },
] };

const catalog = (id: string) => builtinProviders().find((provider) => provider.id === id)!.getModels();

test('读接口：看不见的不要；名字照 pi-ai 的叫法；照同系列版本最高的补，OpenAI 那家上下文封在旧型号的上限', () => {
  const listed = parseListed(LISTED);
  assert.deepEqual(listed.map((item) => item.slug), ['gpt-9.9-astra', 'gpt-6-astra']);
  assert.equal(modelName('GPT-6.2-Sol', 'x'), 'GPT-6.2 Sol');
  assert.equal(modelName(undefined, 'gpt-x'), 'gpt-x');
  assert.equal(baseFor('gpt-9.9-astra', catalog('openai'))?.id, 'gpt-6-astra');
  assert.equal(baseFor('gpt-9.9-nova', catalog('openai-codex'))?.id, 'gpt-6.1-sol', '没有同系列的用版本最高的');
  const openai = estimate(listed[0]!, catalog('openai'), 'openai');
  assert.equal(openai?.name, 'GPT-9.9 Astra');
  assert.equal(openai?.contextWindow, 272_000);
  assert.deepEqual(openai?.cost, catalog('openai').find((model) => model.id === 'gpt-6-astra')?.cost);
  assert.equal(estimate(listed[0]!, catalog('openai-codex'), 'openai-codex')?.contextWindow, 400_000);
  assert.deepEqual(parseListed({ data: [{ id: 'gpt-4o' }] }), [], 'API key 那种格式不认');
});

async function setup(fetched: unknown[]) {
  const handle = await openTestState();
  opened.push(handle);
  const fetch = (async (url: string | URL | Request) => {
    fetched.push(String(url));
    return new Response(JSON.stringify(LISTED), { status: 200 });
  }) as typeof globalThis.fetch;
  const kernel = new KernelModels({ state: handle.state, accountModels: { fetch } });
  return { kernel, state: handle.state, fetch };
}

test('订阅登录：问一次，目录里没有的补进来、标估价，目录里有的不动；重启后不联网也在；6 小时内不再问', async () => {
  const fetched: unknown[] = [];
  const { kernel, state, fetch } = await setup(fetched);
  assert.equal(kernel.models.getModel('openai', 'gpt-9.9-astra'), undefined);
  await kernel.credentials.modify('openai', async () => ({ type: 'oauth', access: 'e30.e30.sig', refresh: 'r',
    expires: Date.now() + 3_600_000 }));
  assert.deepEqual(await kernel.refreshAccountModels({ network: true }), { failed: [] });
  assert.deepEqual(fetched, ['https://api.openai.com/v1/models'], '只问连着的那家');
  assert.equal(kernel.models.getModel('openai', 'gpt-9.9-astra')?.name, 'GPT-9.9 Astra');
  const view = kernel.providers().find((provider) => provider.id === 'openai');
  assert.equal(view?.models.find((model) => model.id === 'gpt-9.9-astra')?.estimated, true);
  assert.equal(view?.models.find((model) => model.id === 'gpt-6-astra')?.estimated, undefined, '目录里有的用目录的');
  assert.equal(view?.models.filter((model) => model.id === 'gpt-6-astra').length, 1);
  await kernel.refreshAccountModels({ network: true });
  assert.equal(fetched.length, 1, '6 小时内问过就不再问');
  await kernel.refreshAccountModels({ network: true, force: true });
  assert.equal(fetched.length, 2);
  const again = new KernelModels({ state, accountModels: { fetch } });
  await again.refreshAccountModels({ network: false });
  assert.equal(again.models.getModel('openai', 'gpt-9.9-astra')?.name, 'GPT-9.9 Astra', '重启后读回来');
  assert.equal(fetched.length, 2, '读回来不联网');
});

test('用 API key 连的不问（格式不一样）；接口出错记下是哪家，设置里照旧', async () => {
  const fetched: unknown[] = [];
  const { kernel } = await setup(fetched);
  await kernel.setApiKey('openai', 'sk-test-key-for-tests');
  assert.deepEqual(await kernel.refreshAccountModels({ network: true }), { failed: [] });
  assert.deepEqual(fetched, []);
  const handle = await openTestState();
  opened.push(handle);
  const broken = new KernelModels({ state: handle.state, accountModels: {
    fetch: (async () => new Response('{}', { status: 401 })) as typeof globalThis.fetch } });
  await broken.credentials.modify('openai', async () => ({ type: 'oauth', access: 'e30.e30.sig', refresh: 'r',
    expires: Date.now() + 3_600_000 }));
  assert.deepEqual(await broken.refreshAccountModels({ network: true }), { failed: ['openai'] });
  assert.equal(broken.models.getModel('openai', 'gpt-6-astra')?.name, 'GPT-6 Astra');
});
