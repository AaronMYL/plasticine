import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { MODEL_PURPOSES } from '../../shared/api/model-purposes.ts';
import { KernelModelError, KernelModels, kernelText, TranslateModel } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { fakeProviders } from './helpers.ts';
import { NoteAssistant } from '../../src/brain/note-assistant.ts';
import { PageTranslator } from '../../src/brain/page-translator.ts';
import { BookInsightService } from '../../src/brain/book-insights.ts';
import { createCompactor } from '../../src/lines/compaction.ts';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { deferred, startKernel, until } from '../lines/helpers.ts';

const opened: TestState[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.cleanup();
});

async function setup() {
  const handle = await openTestState();
  opened.push(handle);
  const fakes = fakeProviders();
  const kernel = new KernelModels({ state: handle.state, providers: fakes.providers });
  await kernel.setApiKey('fake-sub', 'test-sub-key');
  await kernel.setApiKey('fake-key', 'test-only-key');
  kernel.setDefault({ provider: 'fake-sub', model: 'sub-large', thinking: 'medium' });
  kernel.configure({ version: kernel.settings().version, purposes: [], enabled: [
    { provider: 'fake-sub', models: ['sub-large', 'sub-small'] }, { provider: 'fake-key', models: ['key-model'] }] });
  return { kernel, fakes, state: handle.state };
}

test('28 个实际用途分别解析：模型和思考各自继承，改主对话不改全局', async () => {
  const { kernel } = await setup();
  assert.equal(MODEL_PURPOSES.length, 28);
  assert.ok(MODEL_PURPOSES.some((entry) => entry.id === 'web_extract' && entry.label === '网页提取'));
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'main', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
    { purpose: 'note_polish', chosen: { model: null, thinking: 'high' } },
  ] });
  assert.deepEqual(kernel.effective('main'), { provider: 'fake-key', model: 'key-model', thinking: 'medium' });
  assert.deepEqual(kernel.effective('note_polish'), { provider: 'fake-sub', model: 'sub-large', thinking: 'high' });
  kernel.setDefault({ provider: 'fake-sub', model: 'sub-small', thinking: 'low' });
  assert.deepEqual(kernel.effective('main'), { provider: 'fake-key', model: 'key-model', thinking: 'low' });
  assert.deepEqual(kernel.effective('note_polish'), { provider: 'fake-sub', model: 'sub-small', thinking: 'high' });
  assert.equal(kernel.chosen()?.model, 'sub-small');
  assert.equal(kernel.effective('agent')?.model, 'sub-small');
});

test('旧翻译明确选择保留；新设置优先，旧接口和新接口同一真源、版本冲突不覆盖', async () => {
  const { kernel, state } = await setup();
  state.kernelSettings.set('translate_model', { version: 4,
    chosen: { provider: 'fake-key', model: 'key-model', thinking: 'minimal' } });
  // 模拟升级前已保存的选择；新配置出现之前读旧值。
  state.kernelSettings.set('model_purposes', null);
  state.kernelSettings.set('default_model', { provider: 'fake-sub', model: 'sub-large', thinking: 'medium' });
  assert.equal(kernel.effective('translation')?.thinking, 'minimal');
  const version = kernel.settings().version;
  kernel.configure({ version, purposes: [{ purpose: 'translation', chosen: { model: null, thinking: 'high' } }] });
  assert.equal(new TranslateModel(kernel, state).view().effective?.thinking, 'high');
  assert.throws(() => kernel.configure({ version, purposes: [] }),
    (error: unknown) => error instanceof KernelModelError && error.code === 'conflict');
  assert.equal(kernel.effective('translation')?.model, 'sub-large');
});

test('真实模型能力决定思考档位和识图；断开后的实际模型与显示一致', async () => {
  const { kernel } = await setup();
  const model = kernel.models.getModel('fake-key', 'key-model');
  assert.ok(model !== undefined);
  model.thinkingLevelMap = { minimal: null, xhigh: null, max: null };
  model.input = ['text'];
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'note_polish', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'max' } },
  ] });
  const view = kernel.settings().purposes.find((item) => item.purpose === 'note_polish');
  assert.equal(view?.chosen.thinking, 'max');
  assert.equal(view?.effective?.thinking, 'high');
  assert.ok(view?.issue?.includes('思考'));
  assert.deepEqual(kernel.providers()[1]?.models[0]?.thinkingLevels, ['off', 'low', 'medium', 'high']);
  assert.throws(() => kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'payment_read', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: null } },
  ] }), /图片/);
  await kernel.logout('fake-key');
  assert.equal(kernel.current('note_polish')?.model.id, kernel.effective('note_polish')?.model);
});

test('旁路请求真正使用用途模型和思考；快照在排队期间保持模型、思考和缓存身份一致', async () => {
  const { kernel, fakes } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'translation', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' } },
  ] });
  const calls: Array<{ model: string; thinking: unknown }> = [];
  const original = kernel.complete.bind(kernel);
  kernel.complete = (model, context, options) => {
    calls.push({ model: model.id, thinking: options?.reasoning });
    return original(model, context, options);
  };
  const text = kernelText(kernel);
  const snapshot = text.snapshot?.('translation');
  assert.ok(snapshot !== undefined);
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'translation', chosen: { model: null, thinking: 'low' } },
  ] });
  fakes.keyOnly.appendResponses([fauxAssistantMessage('译文')]);
  await snapshot.models.ask({ purpose: 'translation', system: '', messages: [{ role: 'user', content: 'hello' }] },
    new AbortController().signal);
  assert.deepEqual(calls, [{ model: 'key-model', thinking: 'high' }]);
  assert.equal(snapshot.identity, 'fake-key/key-model/high');
  assert.equal(text.snapshot?.('translation').identity, 'fake-sub/sub-large/low');
});

test('全部用途都把已选模型和思考传到实际 provider；不会被请求里的旧 low 覆盖', async () => {
  const { kernel, fakes } = await setup();
  const calls: Array<[string, string, unknown]> = [];
  const capture: FauxResponseFactory = (_context, options, _state, model) => {
    calls.push([model.provider, model.id, options?.reasoning]);
    return fauxAssistantMessage('完成');
  };
  fakes.oauth.appendResponses(Array.from({ length: MODEL_PURPOSES.length }, () => capture));
  fakes.keyOnly.appendResponses(Array.from({ length: MODEL_PURPOSES.length }, () => capture));
  const changes = MODEL_PURPOSES.map(({ id }, index) => ({ purpose: id, chosen: {
    model: index % 2 === 0 ? { provider: 'fake-key', model: 'key-model' }
      : { provider: 'fake-sub', model: 'sub-small' }, thinking: index % 2 === 0 ? 'high' as const : 'minimal' as const,
  } }));
  kernel.configure({ version: kernel.settings().version, purposes: changes });
  for (const { id } of MODEL_PURPOSES) {
    await kernelText(kernel).ask({ purpose: id, reasoning: 'low', system: '',
      messages: [{ role: 'user', content: id }] }, new AbortController().signal);
  }
  assert.deepEqual(calls, changes.map(({ chosen }) => [chosen.model.provider, chosen.model.model, chosen.thinking]));
});

test('八种笔记动作实际分别选模型，用户高思考不会被动作内部降档', async () => {
  const { kernel, fakes } = await setup();
  const actions = ['predict', 'interject', 'polish', 'organize', 'correct', 'format', 'chart', 'custom'] as const;
  kernel.configure({ version: kernel.settings().version, purposes: actions.map((action) => ({
    purpose: `note_${action}`, chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' },
  })) });
  const seen: Array<[string, unknown]> = [];
  fakes.keyOnly.appendResponses(actions.map((action) => (_context, options, _state, model) => {
    seen.push([model.id, options?.reasoning]);
    return fauxAssistantMessage(action === 'interject' ? '[]' : '修改后的文字');
  }));
  const notes = new NoteAssistant(kernelText(kernel));
  for (const action of actions) {
    await notes.suggest({ action, markdown: '原文', instruction: '更具体' }, new AbortController().signal);
  }
  assert.deepEqual(seen, actions.map(() => ['key-model', 'high']));
});

test('主线、子 Agent、封闭的联系人群聊代答分别使用配置；调用到 provider 的 model 和 thinking 都正确', async () => {
  const handle = await openTestState();
  const fakes = fakeProviders();
  const models = new KernelModels({ state: handle.state, providers: fakes.providers });
  await models.setApiKey('fake-sub', 'test-sub-key');
  await models.setApiKey('fake-key', 'test-only-key');
  const calls: Array<[string, unknown]> = [];
  const capture: FauxResponseFactory = (_context, options, _state, model) => {
    calls.push([model.id, options?.reasoning]);
    return fauxAssistantMessage('完成');
  };
  fakes.oauth.appendResponses(Array.from({ length: 12 }, () => capture));
  fakes.keyOnly.appendResponses([capture]);
  models.configure({ version: 0, enabled: [{ provider: 'fake-sub', models: ['sub-large', 'sub-small'] },
    { provider: 'fake-key', models: ['key-model'] }], purposes: [
    { purpose: 'main', chosen: { model: { provider: 'fake-sub', model: 'sub-large' }, thinking: 'high' } },
    { purpose: 'agent', chosen: { model: { provider: 'fake-sub', model: 'sub-small' }, thinking: 'low' } },
    { purpose: 'network_reply', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'minimal' } },
  ] });
  const harness = await startKernel({ handle, extra: { models } });
  try {
    harness.kernel.send('main', { text: '主对话' });
    await harness.kernel.settled();
    harness.kernel.open({ title: '子任务', goal: '普通后台', projectId: null, parentLineId: null });
    await harness.kernel.settled();
    harness.kernel.open({ title: '代答', goal: '回应联系人', projectId: null, parentLineId: null, sealedPrompt: '只回复' });
    await harness.kernel.settled();
    assert.deepEqual(calls, [['sub-large', 'high'], ['sub-small', 'low'], ['key-model', 'minimal']]);
  } finally {
    await harness.close();
  }
});

test('翻译排队后改配置：在途与排队批次保持旧模型身份，新批次按新思考重译再命中缓存', async () => {
  const { kernel, fakes, state } = await setup();
  kernel.configure({ version: kernel.settings().version, purposes: [{ purpose: 'translation',
    chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' } }] });
  const gate = deferred<void>();
  const started = deferred<void>();
  const calls: Array<[string, unknown]> = [];
  const echo: FauxResponseFactory = (context, options, _state, model) => {
    calls.push([model.id, options?.reasoning]);
    const user = context.messages.find((message) => message.role === 'user');
    assert.equal(typeof user?.content, 'string');
    const input = JSON.parse(String(user?.content)) as { items: { id: string; text: string }[] };
    return fauxAssistantMessage(JSON.stringify({ items: input.items.map((item) => ({ id: item.id,
      text: `${model.id}-${options?.reasoning}:${item.text}` })) }));
  };
  fakes.keyOnly.appendResponses([async (...args) => {
    started.resolve();
    await gate.promise;
    return echo(...args);
  }, echo]);
  fakes.oauth.appendResponses([echo]);
  const translator = new PageTranslator({ models: kernelText(kernel), cache: state.translationCache,
    modelName: () => 'unused', glossary: () => [], concurrency: 1 });
  const input = (text: string) => ({ pageUrl: 'https://example.test/page', target: 'zh-CN' as const,
    items: [{ id: 'p', text }], priority: 'visible' as const, glossary: false, timeZone: 'Asia/Shanghai' });
  const signal = new AbortController().signal;
  const first = translator.translate(input('first'), signal);
  await started.promise;
  const queued = translator.translate(input('queued'), signal);
  kernel.configure({ version: kernel.settings().version, purposes: [{ purpose: 'translation',
    chosen: { model: null, thinking: 'low' } }] });
  gate.resolve();
  await first;
  const old = await queued;
  assert.equal(old.model, 'fake-key/key-model/high');
  const next = await translator.translate(input('queued'), signal);
  assert.equal(next.model, 'fake-sub/sub-large/low');
  assert.equal(next.items[0]?.cached, false);
  assert.equal((await translator.translate(input('queued'), signal)).items[0]?.cached, true);
  assert.deepEqual(calls, [['key-model', 'high'], ['key-model', 'high'], ['sub-large', 'low']]);
});

test('图书三阶段实际按各用途执行；归纳缓存随思考和模型改变，已保存结果不自动重做', async () => {
  const { kernel, fakes, state } = await setup();
  const book = state.books.create({ title: '测试书', author: null, language: 'zh', format: 'txt',
    fileName: 'test.txt', sourceBytes: 6, sourceSha256: 'a'.repeat(64), coverAsset: null,
    toc: [{ title: '一章', chars: 2 }], charCount: 2 });
  state.bookFiles.write(book.id, { source: Buffer.from('原文'), format: 'txt', images: [],
    chapters: [{ title: '一章', html: '<p>原文</p>', text: '原文' }] });
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'book_digest', chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' } },
    { purpose: 'book_outline', chosen: { model: { provider: 'fake-sub', model: 'sub-small' }, thinking: 'minimal' } },
    { purpose: 'book_key_points', chosen: { model: { provider: 'fake-sub', model: 'sub-large' }, thinking: 'low' } },
  ] });
  const calls: Array<[string, unknown]> = [];
  const reply: FauxResponseFactory = (context, options, _state, model) => {
    calls.push([model.id, options?.reasoning]);
    const system = context.messages.find((message) => message.role === 'system');
    const prompt = typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
    if (prompt.includes('逐章输出')) {
      return fauxAssistantMessage('{"chapters":[{"index":0,"summary":"章摘要","points":[],"quotes":["原文"]}]}');
    }
    if (prompt.includes('写大纲')) {
      return fauxAssistantMessage('{"summary":"本书围绕示例原文展开讲述，让读者通过章节要点理解内容并回看对应原文。",'
        + '"note":"大纲","parts":[{"chapter":0,"title":"章","summary":"摘要","points":[]}]}');
    }
    return fauxAssistantMessage('{"points":[{"text":"重点","quotes":[{"chapter":0,"text":"原文"}]}]}');
  };
  fakes.keyOnly.appendResponses(Array.from({ length: 8 }, () => reply));
  fakes.oauth.appendResponses(Array.from({ length: 8 }, () => reply));
  const service = new BookInsightService({ state, model: { models: kernelText(kernel) }, now: () => new Date(),
    changed: () => undefined });
  const generate = async (kind: 'outline' | 'key_points', force: boolean) => {
    const row = service.start(book, kind, force);
    await until(() => state.bookInsights.get(row.id)?.status !== 'generating', '图书完成');
    assert.equal(state.bookInsights.get(row.id)?.status, 'ready', state.bookInsights.get(row.id)?.error ?? '');
  };
  await generate('outline', false);
  await generate('key_points', false);
  assert.deepEqual(calls, [['key-model', 'high'], ['sub-small', 'minimal'], ['sub-large', 'low']]);
  kernel.configure({ version: kernel.settings().version, purposes: [{ purpose: 'book_digest',
    chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'low' } }] });
  await generate('outline', false);
  assert.equal(calls.length, 3, '保存结果不会因配置改变自动重新生成');
  await generate('outline', true);
  assert.deepEqual(calls.slice(3), [['key-model', 'low'], ['sub-small', 'minimal']]);
  kernel.configure({ version: kernel.settings().version, purposes: [{ purpose: 'book_digest',
    chosen: { model: { provider: 'fake-sub', model: 'sub-small' }, thinking: 'low' } }] });
  await generate('key_points', true);
  assert.deepEqual(calls.slice(5), [['sub-small', 'low'], ['sub-large', 'low']]);
  service.stop();
});

test('对话压缩调用独立模型与思考；摘要模型窗口较小时分批合并，完整保留库里历史', async () => {
  const { kernel, fakes, state } = await setup();
  const model = kernel.models.getModel('fake-key', 'key-model');
  assert.ok(model !== undefined);
  model.contextWindow = 4096;
  model.maxTokens = 1024;
  kernel.configure({ version: kernel.settings().version, purposes: [{ purpose: 'compaction',
    chosen: { model: { provider: 'fake-key', model: 'key-model' }, thinking: 'high' } }] });
  let calls = 0;
  fakes.keyOnly.appendResponses(Array.from({ length: 10 }, () => (context, options, _state, actual) => {
    calls += 1;
    assert.equal(actual.id, 'key-model');
    assert.equal(options?.reasoning, 'high');
    const chars = context.messages.map((message) => JSON.stringify(message.content)).join('');
    assert.ok(Buffer.byteLength(chars) / 3 + (options?.maxTokens ?? 0) < model.contextWindow);
    return fauxAssistantMessage('完整摘要');
  }));
  const messages: AgentMessage[] = [
    { role: 'user', content: '长中文材料'.repeat(1000), timestamp: 1 },
    fauxAssistantMessage('原来的回答'),
    { role: 'user', content: '继续完成下一步', timestamp: 2 },
  ];
  const compact = createCompactor({ state, models: kernel, now: () => new Date(), keepRecentTokens: 1 });
  const choice = kernel.current('main');
  assert.ok(choice !== undefined);
  const result = await compact(state.lines.main(), messages, (message) => messages.indexOf(message) + 1,
    choice, { force: true });
  assert.ok(calls > 1, '小窗口不能一次装下被压缩的历史');
  assert.equal(result[0]?.role, 'lineSummary');
  assert.equal(state.lines.main().summary, '完整摘要');
  assert.equal(messages.length, 3);
});

test('续写、主动补充默认不开思考：没单独选时用模型支持的最低档，不支持「关」的不报问题；单独选过的照用', async () => {
  const { kernel, fakes } = await setup();
  assert.equal(kernel.effective('note_predict')?.thinking, 'off');
  assert.equal(kernel.effective('note_interject')?.thinking, 'off');
  assert.equal(kernel.effective('note_polish')?.thinking, 'medium');
  // 像 GPT-6.1 Sol：目录里「关」是 null，最低是「低」。不传推理档 OpenAI 会用它自己的默认档，反而更慢。
  const model = kernel.models.getModel('fake-sub', 'sub-large');
  assert.ok(model !== undefined);
  model.thinkingLevelMap = { off: null, minimal: null };
  const view = kernel.settings().purposes.find((item) => item.purpose === 'note_predict');
  assert.equal(view?.effective?.thinking, 'low');
  assert.equal(view?.issue, null);
  kernel.configure({ version: kernel.settings().version, purposes: [
    { purpose: 'note_interject', chosen: { model: null, thinking: 'high' } }] });
  assert.equal(kernel.effective('note_interject')?.thinking, 'high');
  const seen: unknown[] = [];
  fakes.oauth.appendResponses([(_context, options) => {
    seen.push(options?.reasoning);
    return fauxAssistantMessage('续写');
  }]);
  await kernelText(kernel).ask({ purpose: 'note_predict', system: '', messages: [{ role: 'user', content: '前文' }] },
    new AbortController().signal);
  assert.deepEqual(seen, ['low']);
});

test('旁路请求要增量时边生成边给，拼起来和最终回答一样；「关」不传推理档', async () => {
  const { kernel, fakes } = await setup();
  const seen: unknown[] = [];
  const text = '，然后把事实一条一条记清楚，再和上周的记录对一下。';
  fakes.oauth.appendResponses([(_context, options) => {
    seen.push(options?.reasoning);
    return fauxAssistantMessage(text);
  }]);
  const deltas: string[] = [];
  const answer = await kernelText(kernel).ask({ purpose: 'note_predict', system: '',
    messages: [{ role: 'user', content: '前文' }] }, new AbortController().signal, (delta) => deltas.push(delta));
  assert.equal(answer.text, text);
  assert.equal(answer.complete, true);
  assert.ok(deltas.length > 1, '不是一次给全文');
  assert.equal(deltas.join(''), text);
  assert.deepEqual(seen, [undefined]);
  fakes.oauth.appendResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'rate limit 429' })]);
  await assert.rejects(kernelText(kernel).ask({ purpose: 'note_predict', system: '',
    messages: [{ role: 'user', content: '前文' }] }, new AbortController().signal, () => undefined),
  (error: unknown) => error instanceof Error && error.name === 'TextModelError');
});
