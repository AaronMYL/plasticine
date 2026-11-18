// pi-ai 目录里还没有的 GPT-6.2（11-18 Aaron：订阅出了 6.2，设置里没得选）：照上游补上，目录有了就不补。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { CATALOG_ADDITIONS, withCatalogAdditions } from '../../src/kernel/catalog-additions.ts';
import { KernelModels } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const opened: TestState[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.cleanup();
});

function builtin(id: string) {
  const provider = builtinProviders().find((each) => each.id === id);
  assert.ok(provider !== undefined, id);
  return provider;
}

test('OpenAI 和 ChatGPT（Codex）两家都补上 6.2 Astra、Sol：照旧型号抄，换名字、价格、上下文，按名字排进去', () => {
  for (const id of ['openai', 'openai-codex']) {
    const original = builtin(id);
    const patched = withCatalogAdditions(original);
    const ids = patched.getModels().map((model) => model.id);
    assert.ok(ids.includes('gpt-6.2-astra') && ids.includes('gpt-6.2-sol'), id);
    assert.deepEqual(ids, [...ids].sort(), `${id} 还是按名字排`);
    assert.equal(ids[0], original.getModels()[0]?.id, '第一个不变（出图默认拿它）');
    const astra = patched.getModels().find((model) => model.id === 'gpt-6.2-astra');
    const base = original.getModels().find((model) => model.id === 'gpt-6-astra');
    assert.equal(astra?.name, 'GPT-6.2 Astra');
    assert.equal(astra?.api, base?.api);
    assert.deepEqual(astra?.thinkingLevelMap, base?.thinkingLevelMap);
    assert.deepEqual(astra?.cost, { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10,
      tiers: [{ inputTokensAbove: 272_000, input: 16, output: 60, cacheRead: 0.8, cacheWrite: 20 }] });
    assert.ok(patched.getAllModels?.().some((model) => model.id === 'gpt-6.2-sol'));
    assert.equal(patched.streamSimple, original.streamSimple, '请求照旧交给原来那一家');
  }
  const codexSol = withCatalogAdditions(builtin('openai-codex')).getModels()
    .find((model) => model.id === 'gpt-6.2-sol');
  assert.equal(codexSol?.contextWindow, 500_000);
});

test('目录里已经有了就不补，原样返回（升级 pi-ai 以后这份不起作用）', () => {
  const original = withCatalogAdditions(builtin('openai'));
  assert.equal(withCatalogAdditions(original), original);
  const other = builtin('anthropic');
  assert.equal(withCatalogAdditions(other), other);
  assert.ok(CATALOG_ADDITIONS.every((addition) => addition.id.startsWith('gpt-6.2')));
});

test('设置里能看到、能选：KernelModels 列出来、按 id 找得到', async () => {
  const handle = await openTestState();
  opened.push(handle);
  const kernel = new KernelModels({ state: handle.state });
  const openai = kernel.providers().find((provider) => provider.id === 'openai');
  assert.ok(openai?.models.some((model) => model.id === 'gpt-6.2-astra'));
  assert.equal(kernel.models.getModel('openai', 'gpt-6.2-sol')?.name, 'GPT-6.2 Sol');
});
