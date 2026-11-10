import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withMainSoul } from '../../src/app/soul-text.ts';
import { changeSoul, soulView } from '../../src/brain/soul.ts';
import { ensureRulesDoc } from '../../src/brain/memory-doc-writes.ts';
import { memoryState, scriptedText } from '../brain/helpers.ts';

test('旁路模型每次请求重读主线 Soul，专用输出格式保留；封闭网络答复不接入私人规则', async () => {
  const state = memoryState();
  try {
    ensureRulesDoc(state);
    const model = scriptedText(['第一条', '第二条', '封闭回答']);
    const text = withMainSoul(model.models, state);
    const request = { purpose: 'web_extract' as const, system: '只输出 JSON。', messages: [] };
    await text.ask(request, new AbortController().signal);
    assert.match(model.requests[0]!.system, /## 主线的 Soul/);
    assert.ok(model.requests[0]!.system.endsWith('只输出 JSON。'));
    const first = soulView(state).lines[0]!;
    changeSoul(state, { action: 'edit', requestId: 'soul-text-change', id: first.id, version: first.version,
      text: '先给一行重点。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    await text.ask(request, new AbortController().signal);
    assert.match(model.requests[1]!.system, /先给一行重点/);
    assert.doesNotMatch(model.requests[1]!.system, /直接讲内容，先说结论/);
    await text.ask({ ...request, purpose: 'network_reply', system: '只能读授权资料。' }, new AbortController().signal);
    assert.equal(model.requests[2]!.system, '只能读授权资料。');
  } finally { state.close(); }
});

test('固定模型快照仍每次读新 Soul，缓存身份随规则变化，增量回调和取消信号原样传递', async () => {
  const state = memoryState();
  try {
    ensureRulesDoc(state);
    const signal = new AbortController().signal;
    let output = '';
    const model = scriptedText([async (_request, received, onText) => {
      assert.equal(received, signal);
      onText?.('第一条');
      return { text: '第一条', complete: true };
    }]);
    const text = withMainSoul({ ...model.models,
      snapshot: () => ({ identity: 'fixed-model', models: model.models }) }, state);
    const first = text.snapshot!('translation');
    assert.match(first.identity, /^fixed-model:soul:/);
    const row = soulView(state).lines[0]!;
    changeSoul(state, { action: 'edit', requestId: 'soul-snapshot-change', id: row.id, version: row.version,
      text: '翻译用简洁自然的中文。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    assert.notEqual(first.identity, text.snapshot!('translation').identity);
    await first.models.ask({ system: '只给译文', messages: [] }, signal, (delta) => { output += delta; });
    assert.equal(output, '第一条');
    assert.match(model.requests[0]!.system, /翻译用简洁自然的中文/);
  } finally { state.close(); }
});

test('真实装配把笔记、图书、网页和回顾用途接入同一 Soul，修改后全部读新规则', async () => {
  const { startTestApp } = await import('./helpers.ts');
  const app = await startTestApp(['续写', '大纲', '重点', '来信'], { startTasks: false });
  try {
    ensureRulesDoc(app.state);
    const first = soulView(app.state).lines[0]!;
    changeSoul(app.state, { action: 'edit', requestId: 'all-purpose-soul', id: first.id, version: first.version,
      text: '每次直接给出可用结果。', section: 'speaking' }, { actor: 'user', ref: 'device-fixture' });
    for (const purpose of ['note_predict', 'book_outline', 'web_extract', 'review'] as const) {
      await app.app.deps.text.ask({ purpose, system: `专用格式：${purpose}`, messages: [] },
        new AbortController().signal);
    }
    assert.equal(app.requests.length, 4);
    for (const request of app.requests) {
      assert.match(request.system, /每次直接给出可用结果/);
      assert.match(request.system, /专用格式：/);
    }
  } finally { await app.close(); }
});
