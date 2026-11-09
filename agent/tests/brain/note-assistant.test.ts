import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NoteAssistant } from '../../src/brain/index.ts';
import { NOTE_ASSIST_CONTEXT_CHARS } from '../../shared/api/notes-workspace.ts';
import { TextModelError } from '../../src/kernel/index.ts';
import { hangUntilAborted, scriptedText } from './helpers.ts';

test('笔记续写不截字数、提示里不设字数上限，只送必要尾部，不调用工具', async () => {
  const model = scriptedText(['新'.repeat(60)]);
  const assistant = new NoteAssistant(model.models);
  const result = await assistant.suggest({ action: 'predict', markdown: '材料'.repeat(8000) },
    new AbortController().signal);
  assert.equal([...result.markdown].length, 60);
  assert.doesNotMatch(model.requests[0]?.system ?? '', /最多\s*\d+\s*个字/);
  assert.ok(JSON.stringify(model.requests[0]?.messages).length < 7000);
});
test('整篇修改返回完整候选，具体模型失败可见；取消中止在途请求', async () => {
  const model = scriptedText(['# 完整修改稿\n结尾',
    new TextModelError('quota', '当前额度已用尽，请稍后重试'), hangUntilAborted()]);
  const assistant = new NoteAssistant(model.models);
  const input = { action: 'polish' as const, markdown: '# 原文\n正文' };
  assert.equal((await assistant.suggest(input, new AbortController().signal)).markdown, '# 完整修改稿\n结尾');
  await assert.rejects(assistant.suggest(input, new AbortController().signal), /额度已用尽/);
  const abort = new AbortController();
  const pending = assistant.suggest(input, abort.signal);
  await Promise.resolve();
  abort.abort();
  await assert.rejects(pending, /abort|取消/i);
});

test('选段修改带上前后文并明确只修改目标，重复片段使用客户端提供的位置上下文', async () => {
  const model = scriptedText(['改好的这一段']);
  const assistant = new NoteAssistant(model.models);
  await assistant.suggest({ action: 'custom', markdown: '第一次说这件事。\n\n同一句\n\n另一个主题。\n\n同一句',
    selected: '同一句', before: '另一个主题。', after: '它的结论。', instruction: '说得具体些' },
  new AbortController().signal);
  const text = JSON.stringify([model.requests[0]?.system, model.requests[0]?.messages]);
  assert.match(text, /另一个主题/);
  assert.match(text, /它的结论/);
  assert.match(text, /只改目标选段/);
  assert.doesNotMatch(text, /第一次说这件事/);
});

test('续写会看到光标后的文字并避免重复，自定义要求为空时不调用模型', async () => {
  const model = scriptedText(['承接的一句']);
  const assistant = new NoteAssistant(model.models);
  await assistant.suggest({ action: 'predict', markdown: '前半句', after: '已经写好的后半句' },
    new AbortController().signal);
  assert.match(JSON.stringify(model.requests[0]?.messages), /已经写好的后半句/);
  await assert.rejects(assistant.suggest({ action: 'custom', markdown: '原文', instruction: '   ' },
    new AbortController().signal), /修改要求/);
  assert.equal(model.requests.length, 1);
});

test('续写和接话共用较小预算（续写不截字数），长选段和全文按完整目标长度分配生成预算', async () => {
  const model = scriptedText(['建议']);
  const assistant = new NoteAssistant(model.models);
  const signal = new AbortController().signal;
  await assistant.suggest({ action: 'predict', markdown: '正在写作的文字' }, signal);
  await assistant.suggest({ action: 'interject', markdown: '正在写作的文字' }, signal);
  await assistant.suggest({ action: 'format', markdown: '短笔记' }, signal);
  await assistant.suggest({ action: 'polish', markdown: '原文', selected: '中'.repeat(12_000) }, signal);
  await assistant.suggest({ action: 'organize', markdown: '中'.repeat(24_000) }, signal);
  assert.deepEqual(model.requests.map((request) => request.maxOutputTokens), [2048, 2048, 8000, 25_000, 32_000]);
});

test('没有合适续写可以静默返回，超过目标长度或不完整的修改稿不会采用', async () => {
  const model = scriptedText(['', '', async () => ({ text: '未完成的修改稿', complete: false })]);
  const assistant = new NoteAssistant(model.models);
  const signal = new AbortController().signal;
  assert.equal((await assistant.suggest({ action: 'predict', markdown: '前文' }, signal)).markdown, '');
  assert.equal((await assistant.suggest({ action: 'interject', markdown: '前文' }, signal)).markdown, '');
  await assert.rejects(assistant.suggest({ action: 'polish', markdown: '中'.repeat(24_001) }, signal), /分段/);
  await assert.rejects(assistant.suggest({ action: 'polish', markdown: '原文', selected: '中'.repeat(12_001) }, signal),
    /分段/);
  assert.equal(model.requests.length, 2);
  await assert.rejects(assistant.suggest({ action: 'polish', markdown: '原文' }, signal), /没有完整生成/);
});

test('补充看光标附近：带上光标前后两段并说明光标在两段之间，长笔记不再只看整篇最后一段', async () => {
  const model = scriptedText(['要不要先列出证据？']);
  const assistant = new NoteAssistant(model.models);
  const before = `${'很早的背景。'.repeat(2000)}光标前正在写的一段`;
  const after = `光标后已经写好的结论${'后文。'.repeat(3000)}`;
  await assistant.suggest({ action: 'interject', markdown: before, before, after }, new AbortController().signal);
  const system = model.requests[0]?.system;
  const user = model.requests[0]?.messages[0];
  assert.match(system ?? '', /光标在 before 的末尾、after 的开头之间/);
  const payload = JSON.parse(String(user?.content)) as Record<string, unknown>;
  assert.equal(payload['scope'], 'cursor');
  assert.ok(String(payload['before']).endsWith('光标前正在写的一段'));
  assert.equal(String(payload['before']).length, NOTE_ASSIST_CONTEXT_CHARS);
  assert.ok(String(payload['after']).startsWith('光标后已经写好的结论'));
  assert.equal(String(payload['after']).length, NOTE_ASSIST_CONTEXT_CHARS);
  assert.equal(payload['text'], undefined);
});

test('老客户端的补充只带整篇时照旧取最后一段，续写也标出光标前后', async () => {
  const model = scriptedText(['建议']);
  const assistant = new NoteAssistant(model.models);
  const signal = new AbortController().signal;
  await assistant.suggest({ action: 'interject', markdown: `${'开头'.repeat(5000)}整篇最后一句` }, signal);
  await assistant.suggest({ action: 'predict', markdown: '前半句', after: '后半句' }, signal);
  const old = JSON.parse(String(model.requests[0]?.messages[0]?.content)) as Record<string, unknown>;
  assert.ok(String(old['before']).endsWith('整篇最后一句'));
  assert.equal(String(old['before']).length, NOTE_ASSIST_CONTEXT_CHARS);
  const predict = JSON.parse(String(model.requests[1]?.messages[0]?.content)) as Record<string, unknown>;
  assert.deepEqual([predict['scope'], predict['before'], predict['after']], ['cursor', '前半句', '后半句']);
});

test('续写边生成边送：增量去掉和光标前重复的开头再交出，最终文字和送出的一致；补充不流式', async () => {
  const model = scriptedText(['想去公园散步，顺便把这件事想清楚。', '要不要先列证据？']);
  const assistant = new NoteAssistant(model.models);
  const deltas: string[] = [];
  const result = await assistant.suggest({ action: 'predict', markdown: '我今天想去', before: '我今天想去', after: '' },
    new AbortController().signal, (delta) => deltas.push(delta));
  assert.equal(result.markdown, '公园散步，顺便把这件事想清楚。');
  assert.ok(deltas.length > 1, '一段段交出');
  assert.equal(deltas.join(''), result.markdown);
  assert.ok(deltas.every((delta) => delta !== ''));
  const interject: string[] = [];
  const answer = await assistant.suggest({ action: 'interject', markdown: '前文' }, new AbortController().signal,
    (delta) => interject.push(delta));
  assert.equal(answer.markdown, '要不要先列证据？');
  assert.deepEqual(interject, []);
});

test('续写结尾重复了光标后已经写好的开头：最终文字里去掉；不流式的模型也一样去重', async () => {
  const model = scriptedText(['，然后把事实记清楚。后文已写好']);
  const assistant = new NoteAssistant(model.models);
  const input = { action: 'predict' as const, markdown: '正在记录这段经历', before: '正在记录这段经历',
    after: '\n后文已写好的结论。' };
  assert.equal((await assistant.suggest(input, new AbortController().signal, () => undefined)).markdown,
    '，然后把事实记清楚。');
  assert.equal((await assistant.suggest(input, new AbortController().signal)).markdown, '，然后把事实记清楚。');
});

test('续写生成到一半失败或被叫停：照常报错，已经送出的增量由调用方作废', async () => {
  const abort = new AbortController();
  const model = scriptedText([async (_request, _signal, onText) => {
    onText?.('，先写');
    throw new TextModelError('busy', '连不上模型');
  }, async (_request, signal, onText) => {
    onText?.('，再写');
    abort.abort();
    signal.throwIfAborted();
    return { text: '，再写', complete: true };
  }]);
  const assistant = new NoteAssistant(model.models);
  const deltas: string[] = [];
  await assert.rejects(assistant.suggest({ action: 'predict', markdown: '前文' }, new AbortController().signal,
    (delta) => deltas.push(delta)), /续写失败：连不上模型/);
  await assert.rejects(assistant.suggest({ action: 'predict', markdown: '前文' }, abort.signal,
    (delta) => deltas.push(delta)), /abort/i);
  assert.deepEqual(deltas, ['，先写', '，再写']);
});
