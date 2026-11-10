// 主线和旁聊按天分段（《优化清单》第 17 条）：给模型的上下文按天重新起步——每天从记忆库加上前一天的要点开始，
// 不背摘要链；当天太长才压缩，次数有上限；大块的工具结果只放开头和取全文的引用。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { checkedArgs, createCompactor, MAX_DAY_COMPACTIONS, type KernelTool } from '../../src/lines/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { startKernel, systemText, type Harness } from './helpers.ts';

const open: Harness[] = [];
const DAY_MS = 86_400_000;

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

async function harness(options: Parameters<typeof startKernel>[0] = {}): Promise<Harness> {
  const started = await startKernel(options);
  open.push(started);
  return started;
}

function said(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) => {
    if (message.role !== 'user') return [];
    return [typeof message.content === 'string' ? message.content
      : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')];
  });
}

async function turn(h: Harness, text: string, answer: string, lineId = 'main'): Promise<TranscriptContext> {
  let seen: TranscriptContext | null = null;
  h.respond([(context) => {
    seen = context;
    return fauxAssistantMessage(answer);
  }]);
  h.kernel.send(lineId, { text });
  await h.kernel.settled();
  assert.ok(seen !== null, '模型被叫到了');
  return seen;
}

test('新的一天第一轮只带今天的话；前一天的要点进系统提示，昨天的原话不送', async () => {
  const h = await harness();
  await turn(h, '昨天问', '昨天答');
  const yesterday = h.handle.state.lineDays.latest(MAIN_LINE_ID);
  assert.equal(yesterday?.startSeq, 1);
  h.handle.state.lineDays.setDigest(MAIN_LINE_ID, yesterday?.day ?? '', '定了侧栏方案；悬赏还缺赏金来源');
  h.clock.advance(DAY_MS);
  const context = await turn(h, '今天问', '今天答');
  assert.deepEqual(said(context), ['今天问']);
  assert.ok(systemText(context).includes('定了侧栏方案；悬赏还缺赏金来源'));
  assert.ok(systemText(context).includes('conversation_search'), '告诉模型要原话去翻对话');
  const today = h.handle.state.lineDays.latest(MAIN_LINE_ID);
  assert.notEqual(today?.day, yesterday?.day);
  assert.equal(today?.startSeq, 3);
  assert.equal(h.handle.state.lineMessages.after(MAIN_LINE_ID, 0).length, 4, '原话一条不删');
});

test('同一天接着说：上下文带着今天前面的话；没有要点就只用记忆库起步', async () => {
  const h = await harness();
  await turn(h, '第一句', '答一');
  const context = await turn(h, '第二句', '答二');
  assert.deepEqual(said(context), ['第一句', '第二句']);
  assert.ok(!systemText(context).includes('前一天的要点'));
});

test('后台线不按天分段：隔天插话照样带着它前面的话', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage('查完了')]);
  const line = h.kernel.open({ title: '查资料', goal: '查一下', projectId: null, parentLineId: null });
  await h.kernel.settled();
  h.clock.advance(DAY_MS);
  const context = await turn(h, '再补一句', '补完了', line.id);
  assert.deepEqual(said(context), ['查一下', '再补一句']);
  assert.equal(h.handle.state.lineDays.latest(line.id), undefined);
});

const LONG = '这是一段很长的中文材料，用来把这条线撑过压缩的阈值。'.repeat(20);

test(`当天压缩到上限（${MAX_DAY_COMPACTIONS} 次）：不再写摘要，只留今天最近的原话，提示里说清楚`, async () => {
  const h = await harness({ compact: (source, state, now) => createCompactor({ state, models: source, now,
    reserveTokens: 128_000 - 6_000, keepRecentTokens: 200 }) });
  await turn(h, '第一句', '答一');
  const day = h.handle.state.lineDays.latest(MAIN_LINE_ID);
  for (let index = 0; index < MAX_DAY_COMPACTIONS; index += 1) {
    h.handle.state.lineDays.compacted(MAIN_LINE_ID, day?.day ?? '', { summary: '今天的摘要', summarySeq: 1,
      counted: true });
  }
  const context = await turn(h, `第二句：${LONG.repeat(15)}`, '答二');
  assert.ok(!said(context).some((text) => text.startsWith('第一句')), '早先的原话不再送');
  assert.ok(said(context).some((text) => text.includes('今天的摘要')), '已有的摘要还在');
  const prompt = systemText(context);
  assert.ok(prompt.includes(`压缩过 ${MAX_DAY_COMPACTIONS} 次`));
  assert.doesNotMatch(prompt, /open_side_chat|旁聊/);
  assert.match(prompt, /mate_list.*mate_handoff/);
  assert.match(prompt, /没有合适队友.*start_line/);
  const after = h.handle.state.lineDays.latest(MAIN_LINE_ID);
  assert.equal(after?.compactions, MAX_DAY_COMPACTIONS, '没有再写摘要');
  assert.ok((after?.summarySeq ?? 0) >= 2, '窗口往后挪了');
  assert.equal(h.handle.state.lines.main().summary, null, '主线不再用线上的摘要链');
});

function bigTool(text: string): KernelTool {
  const parameters = Type.Object({}, { additionalProperties: false });
  return { name: 'read_page', say: () => '读网页', hardLine: () => null, create: () => ({
    name: 'read_page', label: '读网页', description: '读一页', parameters,
    execute: async (_id, raw) => {
      checkedArgs(parameters, raw, 'read_page');
      return { content: [{ type: 'text', text }], details: {} };
    },
  }) };
}

test('大块的工具结果不进上下文：只放开头和引用，read_result 按段取回全文', async () => {
  const page = `开头${'正文'.repeat(6_000)}结尾`;
  const h = await harness({ tools: [bigTool(page)] });
  let seen: string[] = [];
  let fetched = '';
  h.respond([
    fauxAssistantMessage([fauxToolCall('read_page', {}, { id: 'p' })], { stopReason: 'toolUse' }),
    (context) => {
      seen = context.messages.flatMap((message) => (message.role === 'toolResult'
        ? message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])) : []));
      return fauxAssistantMessage([fauxToolCall('read_result', { ref: `line:${MAIN_LINE_ID}:3`, offset: 11_000 },
        { id: 'r' })], { stopReason: 'toolUse' });
    },
    (context) => {
      const last = context.messages.at(-1);
      fetched = last?.role === 'toolResult' ? last.content.flatMap((part) => (part.type === 'text' ? [part.text]
        : [])).join('') : '';
      return fauxAssistantMessage('读完了');
    },
  ]);
  h.kernel.send('main', { text: '读一下' });
  await h.kernel.settled();
  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.startsWith('开头'));
  assert.ok(seen[0]!.length < 3_000, '只放开头');
  assert.ok(seen[0]!.includes(`line:${MAIN_LINE_ID}:3`), '带着取全文的引用');
  assert.ok(fetched.includes('结尾'), '按段取回了后面');
  const stored = h.handle.state.lineMessages.get(MAIN_LINE_ID, 3);
  assert.ok(JSON.stringify(stored?.message).includes('结尾'), '库里存的是全文');
});

test('旁聊用旁聊的模型（用途 side），主线用 main', async () => {
  const h = await harness();
  const side = h.kernel.openSide({ title: '讨论一下', topic: null });
  assert.equal(side.kind, 'side');
  await turn(h, '旁聊里说', '好', side.id);
  assert.ok(h.purposes.includes('side'));
  assert.ok(!h.purposes.includes('agent'));
});
