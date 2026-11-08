// 第四级：压缩。估计的 token 超过阈值时把早先的消息写成摘要存到线的 summary，只送摘要 + 最近的消息；库里的消息一条
// 不删。模型说上下文超了：压一次再试。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { createCompactor, findCut, serializeForSummary } from '../../src/lines/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { echoTool, startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

// 假模型一次能读 128 000；余量设成上下文到约 6 000 token 就压（系统提示加工具约一两千），留最近约 200 token。
const WINDOW = 128_000;

async function harness(): Promise<Harness> {
  const started = await startKernel({ tools: [echoTool()], compact: (source, state, now) => createCompactor({
    state, models: source, now, reserveTokens: WINDOW - 6_000, keepRecentTokens: 200 }) });
  open.push(started);
  return started;
}

const LONG = '这是一段很长的中文材料，用来把这条线撑过压缩的阈值。'.repeat(20);

function userTexts(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) => (message.role === 'user' && typeof message.content === 'string'
    ? [message.content] : []));
}

test('超过阈值：早先的消息写成摘要存到线上，送给模型的是摘要 + 最近的；库里的消息一条不少', async () => {
  const h = await harness();
  for (const round of ['一', '二']) {
    h.respond([fauxAssistantMessage(`第${round}轮答。`)]);
    h.kernel.send('main', { text: `第${round}轮问` });
    await h.kernel.settled();
  }
  assert.equal(h.handle.state.lineDays.latest(MAIN_LINE_ID)?.summary, null, '还没到阈值');
  let summaryPrompt = '';
  let seen: string[] = [];
  h.respond([
    (context) => {
      summaryPrompt = userTexts(context).join('\n');
      return fauxAssistantMessage('## 目标\n- 测压缩\n\n## 进度\n### 做完了\n- [x] 前两轮');
    },
    (context) => {
      seen = userTexts(context);
      return fauxAssistantMessage('第三轮答。');
    },
  ]);
  const third = `第三轮问：${LONG.repeat(15)}`;
  h.kernel.send('main', { text: third });
  await h.kernel.settled();
  assert.ok(summaryPrompt.includes('<conversation>'));
  assert.ok(summaryPrompt.includes('[用户]：第一轮问'));
  // 主线按天分段（第 17 条）：摘要记在今天上，线上的旧摘要链不再用。
  const day = h.handle.state.lineDays.latest(MAIN_LINE_ID);
  assert.ok(day?.summary?.includes('测压缩'));
  assert.ok((day?.summarySeq ?? 0) >= 2);
  assert.equal(day?.compactions, 1);
  assert.equal(h.handle.state.lines.main().summary, null);
  assert.ok(seen[0]?.includes('压缩成下面的摘要'), '摘要在最前面');
  assert.ok(!seen.some((text) => text.startsWith('第一轮问')), '第一轮的原话不再送');
  assert.equal(seen.at(-1), third);
  assert.equal(h.handle.state.lineMessages.after(MAIN_LINE_ID, 0).length, 6, '库里一条不删');
  assert.equal(h.kernel.view('main').lastAnswer, '第三轮答。');
});

test('模型说上下文超了：压一次再试，这一轮照样答完', async () => {
  const h = await harness();
  h.respond([fauxAssistantMessage(`答：${LONG}`)]);
  h.kernel.send('main', { text: `问：${LONG}` });
  await h.kernel.settled();
  h.respond([
    fauxAssistantMessage('', { stopReason: 'error',
      errorMessage: 'prompt is too long: 300000 tokens > 200000 maximum' }),
    fauxAssistantMessage('## 目标\n- 接着答'),
    fauxAssistantMessage('压完答上了。'),
  ]);
  h.kernel.send('main', { text: '再问一句' });
  await h.kernel.settled();
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.view('main').lastAnswer, '压完答上了。');
  assert.ok(h.handle.state.lineDays.latest(MAIN_LINE_ID)?.summary?.includes('接着答'));
});

test('切点只落在用户的话或回答上，不把工具结果和它的调用拆开', () => {
  const call = fauxAssistantMessage([fauxToolCall('echo', { text: 'x' }, { id: 'c' })], { stopReason: 'toolUse' });
  const messages: AgentMessage[] = [
    { role: 'user', content: LONG, timestamp: 1 },
    call,
    { role: 'toolResult', toolCallId: 'c', toolName: 'echo', content: [{ type: 'text', text: LONG }], isError: false,
      timestamp: 2 },
    fauxAssistantMessage('好'),
  ];
  const cut = findCut(messages, 10);
  assert.notEqual(messages[cut]?.role, 'toolResult');
  assert.equal(findCut(messages, 1_000_000), 0, '攒不够就不切');
  const text = serializeForSummary([{ role: 'user', content: '问', timestamp: 1 }, call]);
  assert.ok(text.includes('[AI 调用工具]：echo({"text":"x"})'));
});
