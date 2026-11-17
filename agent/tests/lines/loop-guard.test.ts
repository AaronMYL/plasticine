// 拦不收敛的线（内核优化第一批，11-17）：同样的失败提醒、拦下，同一种操作连续失败停下来交回，每 60 步对一次进度，
// 兜底 300 步。后台线停下来；主线只提醒、只拦同样的调用。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { KernelTool } from '../../src/lines/index.ts';
import { CHECKPOINT_STEPS, EXACT_FAILURE_BLOCK, kindOf, LoopGuard, SAME_KIND_FAILURE_HALT, STEP_LIMIT }
  from '../../src/lines/loop-guard.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { scriptByLine, startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const click = (target: string) => ({ name: 'device_action', args: { action: { kind: 'tab_click', text: target } } });

test('同一个调用同样失败：第 2 次起提醒，失败 5 次以后同样的调用不再执行；换了参数照常', () => {
  const guard = new LoopGuard({ hardStops: false });
  assert.deepEqual(guard.after(click('保存'), true, '没找到').notes, []);
  assert.match(guard.after(click('保存'), true, '没找到').notes[0] ?? '', /同样失败 2 次/);
  for (let count = 3; count <= EXACT_FAILURE_BLOCK; count += 1) {
    assert.equal(guard.before(click('保存')), null);
    guard.after(click('保存'), true, '没找到');
  }
  assert.match(guard.before(click('保存'))?.block ?? '', /不再执行/);
  assert.equal(guard.before(click('提交')), null, '参数不一样的照常');
});

test('同一种操作连续失败：第 3 次提醒；做成一次就重新数；主线不停下来', () => {
  const guard = new LoopGuard({ hardStops: false });
  assert.equal(kindOf(click('甲')), 'device_action:tab_click');
  guard.after(click('甲'), true, '错');
  guard.after(click('乙'), true, '错');
  assert.match(guard.after(click('丙'), true, '错').notes[0] ?? '', /连续失败 3 次/);
  guard.after(click('丁'), false, '点好了');
  assert.deepEqual(guard.after(click('戊'), true, '错').notes, [], '做成过一次，重新数');
  for (let count = 0; count < SAME_KIND_FAILURE_HALT; count += 1) {
    assert.equal(guard.after(click(`第${count}个`), true, '错').halt, null, '主线只提醒');
  }
});

test('后台线：同一种操作连续失败 8 次停下来；到 300 步停下来', () => {
  const guard = new LoopGuard({ hardStops: true });
  for (let count = 1; count < SAME_KIND_FAILURE_HALT; count += 1) {
    assert.equal(guard.after(click(`第${count}个`), true, '错').halt, null);
  }
  assert.equal(guard.after(click('最后一个'), true, '错').halt, 'stuck');
  const long = new LoopGuard({ hardStops: true });
  for (let step = 0; step < STEP_LIMIT; step += 1) {
    long.step();
  }
  assert.equal(long.before({ name: 'echo', args: { text: '下一步' } })?.halt, 'step_limit');
});

test('原地重读：同一次读线连着读到一模一样的结果，第 2 次提醒；动手的调用结果一样不提醒', () => {
  const guard = new LoopGuard({ hardStops: true });
  const read = { name: 'read_line', args: { lineId: 'line-a' } };
  assert.deepEqual(guard.after(read, false, '还在做').notes, []);
  assert.match(guard.after(read, false, '还在做').notes[0] ?? '', /一模一样/);
  assert.deepEqual(guard.after(read, false, '做完了').notes, [], '结果变了，重新数');
  const echo = { name: 'echo', args: { text: '同样的话' } };
  guard.after(echo, false, '回声');
  assert.deepEqual(guard.after(echo, false, '回声').notes, []);
});

test('每 60 步提醒对一次进度，只提醒一次', () => {
  const guard = new LoopGuard({ hardStops: true });
  for (let step = 0; step < CHECKPOINT_STEPS; step += 1) {
    guard.step();
  }
  const echo = { name: 'echo', args: { text: '一' } };
  assert.match(guard.after(echo, false, '回声：一').notes[0] ?? '', /已经做了 60 步/);
  assert.deepEqual(guard.after({ name: 'echo', args: { text: '二' } }, false, '回声：二').notes, []);
});

/** 总是失败的点按：记下真的执行了几次。 */
function failingTool(ran: string[]): KernelTool {
  const parameters = Type.Object({ target: Type.String() }, { additionalProperties: false });
  return {
    name: 'press',
    say: (args) => `点「${String(args['target'] ?? '')}」`,
    hardLine: () => null,
    create: () => ({
      name: 'press', label: '点', description: '点一下', parameters,
      execute: async (_id, raw) => {
        ran.push(String((raw as { target: string }).target));
        throw new Error('页面上没找到这一项');
      },
    }),
  };
}

function toolTexts(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) => (message.role === 'toolResult'
    ? [message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')] : []));
}

const press = (target: string) => fauxAssistantMessage([fauxToolCall('press', { target })],
  { stopReason: 'toolUse' as const });

test('主线：同样的失败第 2 次结果后面带提醒，失败 5 次以后同样的调用不再执行，这一轮照样答完', async () => {
  const ran: string[] = [];
  const h = await startKernel({ tools: [failingTool(ran)] });
  open.push(h);
  let seen: string[] = [];
  h.respond([
    ...Array.from({ length: EXACT_FAILURE_BLOCK + 1 }, () => press('保存')),
    (context) => {
      seen = toolTexts(context);
      return fauxAssistantMessage('保存按钮点不了，卡在这一步。');
    },
  ]);
  h.kernel.send('main', { text: '帮我点保存' });
  await h.kernel.settled();
  assert.equal(ran.length, EXACT_FAILURE_BLOCK, '第 6 次没有真的执行');
  assert.ok(!seen[0]?.includes('内核提醒'));
  assert.match(seen[1] ?? '', /同样失败 2 次/);
  assert.match(seen.at(-1) ?? '', /不再执行/);
  assert.equal(h.kernel.view('main').status, 'idle');
  assert.equal(h.kernel.view('main').lastAnswer, '保存按钮点不了，卡在这一步。');
});

test('后台线：同一种操作连续失败 8 次，这件事停下来记成没做完，原因交回发起它的线', async () => {
  const ran: string[] = [];
  const h = await startKernel({ tools: [failingTool(ran)] });
  open.push(h);
  // 主线和后台线各走各的剧本；后台线停下后原因贴回主线，主线再答一句。
  scriptByLine(h, {
    '这是主对话': [
      fauxAssistantMessage([fauxToolCall('start_line', { title: '点完八个按钮', goal: '把八个按钮都点一遍' })],
        { stopReason: 'toolUse' as const }),
      fauxAssistantMessage('交给后台线了。'),
      fauxAssistantMessage('后台线卡住了，按钮点不了。'),
      fauxAssistantMessage('后台线接着做完了。'),
    ],
    '点完八个按钮': [...Array.from({ length: SAME_KIND_FAILURE_HALT }, (_unused, index) => press(`按钮${index + 1}`)),
      fauxAssistantMessage('换了办法，八个都点好了。')],
  });
  h.kernel.send('main', { text: '把那八个按钮都点一遍' });
  await h.kernel.settled();
  const line = h.kernel.list({ kind: 'background', limit: 10 })[0];
  assert.equal(line?.status, 'failed');
  assert.match(line?.failure ?? '', /同一种操作连续没做成（点「按钮8」）/);
  assert.equal(ran.length, SAME_KIND_FAILURE_HALT);
  const reports = h.handle.state.lineMessages.after(MAIN_LINE_ID, 0).filter((row) => row.role === 'lineReport');
  assert.equal(reports.length, 1);
  assert.match(JSON.stringify(reports[0]?.message), /先停下了/);
  // 停下来的线能接着做：从库里接着跑，重新数。
  h.kernel.retry(line?.id ?? '');
  await h.kernel.settled();
  assert.equal(h.kernel.view(line?.id ?? '').status, 'idle');
  assert.equal(h.kernel.view(line?.id ?? '').lastAnswer, '换了办法，八个都点好了。');
});
