// 预测闭环第三步：权限是挣出来的。同一类推出来的卡连续原样同意 5 次 → 出放手卡；他点「以后直接做」→ 这一类不再出卡、
// 按推荐直接做；loop_take_back 收回 → 照常出卡。改了一次就从头数。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { Ask } from '../../shared/state.ts';
import { Changes } from '../../src/attention/index.ts';
import { offerResolver, OFFER_PURPOSE } from '../../src/loop/autonomy.ts';
import { OFFER_STREAK } from '../../src/loop/tally.ts';
import { startKernel, until, type Harness } from '../lines/helpers.ts';

const open: Harness[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

function lastResult(context: TranscriptContext): string {
  const message = [...context.messages].reverse().find((entry) => entry.role === 'toolResult');
  const part = message?.role === 'toolResult' ? message.content[0] : undefined;
  return part?.type === 'text' ? part.text : '';
}

const askCall = (id: string) => fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'confirm',
  question: '下周三上午开会？', basis: 'inferred', topic: '排日程',
  options: [{ id: 'yes', label: '周三上午', recommended: true }, { id: 'no', label: '换个时间' }] }, { id })],
{ stopReason: 'toolUse' });

function questions(h: Harness, purpose: string): Ask[] {
  return h.handle.state.asks.between('0000', '9999').filter((ask) => ask.purpose === purpose);
}

async function round(h: Harness, index: number, optionId: 'yes' | 'no'): Promise<void> {
  h.kernel.send('main', { text: `约第 ${index} 个会` });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  const ask = h.handle.state.asks.open().find((entry) => entry.purpose === 'line_question');
  assert.ok(ask !== undefined);
  h.desk.answer({ askId: ask.id, optionId, answerer: { deviceId: 'device-mac' } });
  await h.kernel.settled();
}

test('five kept answers in a row earn an offer; a grant skips the card; taking it back asks again', async () => {
  const h = await startKernel({});
  open.push(h);
  const script = [];
  for (let index = 0; index <= OFFER_STREAK; index += 1) {
    script.push(askCall(`ask-${index}`), fauxAssistantMessage(`第 ${index} 次好了`));
  }
  script.push(askCall('ask-auto'), (context: TranscriptContext) => fauxAssistantMessage(`结果：${lastResult(context)}`));
  script.push(fauxAssistantMessage([fauxToolCall('loop_take_back', { topic: '排日程', reason: '他说还是先问我' },
    { id: 'take-back' })], { stopReason: 'toolUse' }), fauxAssistantMessage('收回了'));
  script.push(askCall('ask-after'), fauxAssistantMessage('照常问了'));
  h.respond(script);

  await round(h, 0, 'no');
  for (let index = 1; index < OFFER_STREAK; index += 1) {
    await round(h, index, 'yes');
  }
  assert.equal(questions(h, OFFER_PURPOSE).length, 0, '中间改过一次：从头数，还不够 5 次');
  await round(h, OFFER_STREAK, 'yes');
  const offers = questions(h, OFFER_PURPOSE);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.basis, 'hard_line');
  assert.match(offers[0]?.question ?? '', /排日程/);

  const answered = h.desk.answer({ askId: offers[0]!.id, optionId: 'yes', answerer: { deviceId: 'device-mac' } });
  offerResolver(h.handle.state).resolve(new Changes(), answered.ask, { deviceId: 'device-mac' },
    '2026-11-13T00:00:00.000Z');
  assert.equal(h.handle.state.loop.grants.active('排日程')?.sourceAskId, offers[0]!.id);

  const before = questions(h, 'line_question').length;
  h.kernel.send('main', { text: '再约一个' });
  await h.kernel.settled();
  assert.equal(questions(h, 'line_question').length, before, '放过手：不出卡');
  assert.match(h.kernel.view('main').lastAnswer ?? '', /他放过手.*周三上午/);

  h.kernel.send('main', { text: '这类还是先问我吧' });
  await h.kernel.settled();
  assert.equal(h.handle.state.loop.grants.active('排日程'), undefined);
  h.kernel.send('main', { text: '再约' });
  await until(() => h.kernel.view('main').status === 'waiting', '收回以后照常出卡');
  assert.equal(questions(h, 'line_question').length, before + 1);
});
