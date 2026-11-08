// 线跑完了不等于事做成了（走查 11-07：「设置每日抖音续火花任务」没建成也打了勾）。后台线用 line_outcome 明说做成没有；
// 没做成带一句原因，贴回去的结果和线的样子都带上。没说过的（旧记录）照旧按做完，不靠关键词猜。

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

test('没做成：line_outcome 写明原因，线的样子和贴回主对话的结果都带上，模型看到的也是「没做成」', async () => {
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

test('做成了：line_outcome done，unmet 是 null，结果照旧打勾', async () => {
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

test('没说做成没有（旧记录、没调）：照旧按做完，不按文字猜', async () => {
  const h = await harness();
  scriptByLine(h, { [MAIN]: spawn(), [TITLE]: [fauxAssistantMessage('没建成，也没有发出任何消息。')] });
  h.kernel.send('main', { text: '帮我每天续火花' });
  await h.kernel.settled();
  const child = h.kernel.list({ kind: 'background', limit: 5 })[0];
  assert.equal(child?.unmet, null);
  assert.equal(h.kernel.read('main', 50).messages.find((message) => message.role === 'lineReport')?.ok, true);
});

test('没做成必须写原因：没写就报错，不记成没做成', async () => {
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

test('主对话没有 line_outcome：调了也只是找不到这件工具，主线不记做成没有', async () => {
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

test('再给这条线说一句，上一轮的「没做成」不再算数', async () => {
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
