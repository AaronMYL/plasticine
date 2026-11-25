import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { LineInputOrigin } from '../../shared/api/lines.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { scriptByLine, startKernel } from './helpers.ts';

test('Messages and live receipts keep real source; unknown history not rewritten user', async () => {
  const h = await startKernel();
  try {
    const origins: LineInputOrigin[] = [
      { kind: 'user', userText: '本人输入' }, { kind: 'delegation' }, { kind: 'trigger' },
      { kind: 'network' }, { kind: 'system' },
    ];
    h.respond(origins.map(() => fauxAssistantMessage('收到')));
    for (const origin of origins) {
      const response = h.kernel.send('main', { text: `${origin.kind} 的输入`, origin });
      assert.equal(response.outcome, 'started');
      assert.deepEqual(response.message?.origin, origin);
      await h.kernel.settled();
    }
    const old = h.handle.state.lineMessages.append(MAIN_LINE_ID, 'user',
      { role: 'user', content: '旧记录', timestamp: h.clock.now().getTime() });
    const messages = h.kernel.read('main', 50).messages;
    assert.deepEqual(messages.filter((message) => message.role === 'user').slice(0, origins.length)
      .map((message) => message.origin), origins);
    assert.deepEqual(messages.find((message) => message.seq === old.seq)?.origin,
      { kind: 'unknown' });
    const events = h.events.flatMap((event) => event.type === 'line_message' && event.message.role === 'user'
      ? [event.message.origin] : []);
    assert.deepEqual(events, origins);
  } finally {
    await h.close();
  }
});

test('Delegations and user inputs received while paused stay distinct across restart', async () => {
  const h = await startKernel();
  try {
    h.kernel.halt('main');
    h.kernel.tell('main', '查另一份资料');
    h.kernel.send('main', { text: '我再补一句' });
    const expected = [{ kind: 'delegation' }, { kind: 'user', userText: '我再补一句' }];
    assert.deepEqual(h.kernel.read('main', 50).queue.map((item) => item.origin), expected);
    await h.kernel.stop();
    const resumed = await startKernel({ handle: h.handle });
    try {
      assert.deepEqual(resumed.kernel.read('main', 50).queue.map((item) => item.origin), expected);
    } finally {
      await resumed.kernel.stop();
    }
  } finally {
    await h.close();
  }
});

test('read_line returns source and protocol role; delegation uses user role not self', async () => {
  const h = await startKernel();
  try {
    h.handle.state.lineMessages.append(MAIN_LINE_ID, 'user',
      { role: 'user', content: '它分派的工作', timestamp: h.clock.now().getTime() },
      { origin: { kind: 'delegation' } });
    h.respond([
      fauxAssistantMessage([fauxToolCall('read_line', { lineId: MAIN_LINE_ID }, { id: 'read' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('读到了'),
    ]);
    h.kernel.send('main', { text: '读记录' });
    await h.kernel.settled();
    const result = h.handle.state.lineMessages.after(MAIN_LINE_ID, 0)
      .find((row) => row.role === 'toolResult')?.message;
    const content: unknown = Reflect.get(result as object, 'content');
    assert.ok(Array.isArray(content));
    const text = (content as { text: string }[]).map((part) => part.text).join('');
    const read: { messages: { text: string; role: string; origin: LineInputOrigin }[] } = JSON.parse(text);
    assert.deepEqual(read.messages.find((message) => message.text === '它分派的工作'),
      { seq: 1, role: 'user', text: '它分派的工作', origin: { kind: 'delegation' }, steps: [], ok: null });
  } finally {
    await h.close();
  }
});

test('Child line stores trigger message seq for stable card order in same ms/reload', async () => {
  const h = await startKernel();
  try {
    scriptByLine(h, {
      这是主对话: [
        fauxAssistantMessage([{ type: 'text', text: '我先查原始资料。' },
          fauxToolCall('start_line', { title: '查原始资料', goal: '查看引用的原文' }, { id: 'spawn-one' })],
        { stopReason: 'toolUse' }),
        fauxAssistantMessage('你可以继续聊。'),
      ],
      查原始资料: [fauxAssistantMessage('查完了。')],
    });
    h.kernel.send('main', { text: '帮我查一下' });
    await h.kernel.settled();
    const parent = h.kernel.read('main', 50).messages.find((message) => message.steps
      .some((step) => step.toolCallId === 'spawn-one'));
    const child = h.kernel.list({ limit: 20 }).find((line) => line.parentLineId === MAIN_LINE_ID);
    assert.ok(parent);
    assert.ok(child);
    assert.equal(child.parentMessageSeq, parent.seq);
    assert.deepEqual(h.kernel.read(child.id, 50).messages[0]?.origin,
      { kind: 'delegation', ref: `line:${MAIN_LINE_ID}:${parent.seq}` });
    assert.equal(h.kernel.view(child.id).parentMessageSeq, parent.seq);
  } finally {
    await h.close();
  }
});
