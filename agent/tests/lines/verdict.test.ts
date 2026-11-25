import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { scriptByLine, startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(): Promise<Harness> {
  const started = await startKernel();
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const MAIN = '这是主对话';
const TITLE = '设置每日抖音续火花任务';

function spawn(): ReturnType<typeof fauxAssistantMessage>[] {
  return [
    fauxAssistantMessage([fauxToolCall('start_line', { title: TITLE, goal: '每天提醒续火花' }, { id: 'spawn' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage('开了一条线去设。'),
  ];
}

test('Unmet line_outcome attaches reason to line, main delivery, and model context', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: spawn(),
    [TITLE]: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: false, reason: '当时还不能新建定时任务' },
        { id: 'verdict' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('**这项定时任务还没建成，也没有发出任何消息。**'),
    ],
  });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  assert.equal(child?.outcome, 'done', '这一轮照常结束');
  assert.equal(child?.unmet, '当时还不能新建定时任务');
  const report = h.kernel.read('main', 50).messages.find((message) => message.role === 'lineReport');
  assert.equal(report?.ok, false);
  assert.equal(report?.stopReason, 'unmet');
  const stored = h.handle.state.lineMessages.last(h.handle.state.lines.main().id, 'lineReport')?.message as
    { unmet?: string } | undefined;
  assert.equal(stored?.unmet, '当时还不能新建定时任务');
  const tool = h.kernel.read(child!.id, 50).messages.find((message) => message.role === 'toolResult');
  assert.equal(tool?.say, '没做成：当时还不能新建定时任务');
});

test('Done line_outcome sets unmet to null and marks result complete as usual', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: spawn(),
    [TITLE]: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: true }, { id: 'verdict' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('建好了，每天 21:00 提醒。'),
    ],
  });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  assert.equal(child?.unmet, null);
  const report = h.kernel.read('main', 50).messages.find((message) => message.role === 'lineReport');
  assert.equal(report?.ok, true);
});

test('Omitted line_outcome (legacy/uncalled) treats line as done without text guessing', async () => {
  const h = await harness();
  scriptByLine(h, { [MAIN]: spawn(), [TITLE]: [fauxAssistantMessage('没建成，也没有发出任何消息。')] });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  assert.equal(child?.unmet, null);
  assert.equal(h.kernel.read('main', 50).messages.find((message) => message.role === 'lineReport')?.ok, true);
});

test('Unmet line_outcome requires a reason; empty reason errors without marking unmet', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: spawn(),
    [TITLE]: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: false }, { id: 'bad' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('好。'),
    ],
  });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  const result = h.kernel.read(child!.id, 50).messages.find((message) => message.role === 'toolResult');
  assert.equal(result?.ok, false);
  assert.match(result?.text ?? '', /原因/);
  assert.equal(child?.unmet, null);
});

test('Main chat has no line_outcome tool; calling it fails and does not record outcome', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: false, reason: '试试' }, { id: 'main' })],
        { stopReason: 'toolUse' }),
      fauxAssistantMessage('好。'),
    ],
  });
  h.kernel.send('main', { text: '你好' });
  await h.kernel.settled();
  const result = h.kernel.read('main', 50).messages.find((message) => message.role === 'toolResult');
  assert.equal(result?.ok, false);
  assert.equal(h.handle.state.lines.main().unmetReason, null);
});

test('Sending a new message to an unmet line clears the previous unmet status', async () => {
  const h = await harness();
  scriptByLine(h, {
    [MAIN]: spawn(),
    [TITLE]: [
      fauxAssistantMessage([fauxToolCall('line_outcome', { done: false, reason: '当时还不能新建定时任务' },
        { id: 'verdict' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('没建成。'),
      fauxAssistantMessage('现在建好了。'),
    ],
  });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0]!;
  assert.equal(child.unmet, '当时还不能新建定时任务');
  h.kernel.send(child.id, { text: '现在可以建了，再试一次' });
  await h.kernel.settled();
  assert.equal(h.kernel.view(child.id).unmet, null);
});
