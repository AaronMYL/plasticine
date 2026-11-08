import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { AttentionError, channelForAsk, type RaiseAsk } from '../../src/attention/index.ts';
import { harness, type Harness } from './desk-harness.ts';

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => {
  h.close();
});

function card(overrides: Partial<RaiseAsk> = {}): RaiseAsk {
  return {
    kind: 'decide',
    purpose: 'line_question',
    question: '周报发给谁？',
    options: [
      { id: 'team', label: '发给组里' },
      { id: 'boss', label: '只发老板', recommended: true },
    ],
    ...overrides,
  };
}

function raise(overrides: Partial<RaiseAsk> = {}) {
  return h.desk.commit((changes) => h.desk.raise(changes, card(overrides)));
}

function closed(work: () => unknown, code: AttentionError['code']): void {
  assert.throws(work, (error: unknown) => error instanceof AttentionError && error.code === code);
}

test('出卡：推荐项排到第一个；同一个动作标识只出一张；提交之后才推给设备', () => {
  const ask = raise({ actionId: 'act-1' });
  assert.deepEqual(ask.options.map((option) => [option.id, option.recommended]), [['boss', true], ['team', false]]);
  assert.equal(raise({ actionId: 'act-1', question: '换了说法' }).id, ask.id);
  assert.equal(h.state.asks.open().length, 1);
  const created = h.presented.filter((entry) => entry.type === 'ask_created');
  assert.equal(created.length, 1);
});

test('出卡的事务回滚时卡不留，也不推', () => {
  assert.throws(() =>
    h.desk.commit((changes) => {
      h.desk.raise(changes, card());
      throw new Error('后面一步失败了');
    }),
  );
  assert.equal(h.state.asks.open().length, 0);
  assert.equal(h.presented.length, 0);
});

test('一张卡最多一个推荐项，选项 id 不能重复', () => {
  const twoRecommended = card({
    options: [
      { id: 'a', label: 'A', recommended: true },
      { id: 'b', label: 'B', recommended: true },
    ],
  });
  closed(() => h.desk.commit((changes) => h.desk.raise(changes, twoRecommended)), 'invalid_ask');
  const duplicate = card({ options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] });
  closed(() => h.desk.commit((changes) => h.desk.raise(changes, duplicate)), 'invalid_ask');
});

test('作答：卡记下谁、什么时候答的（2026-11-05 起不再另写一条「选择：…」的消息）；另一台设备再答是 ask_closed', () => {
  const ask = raise();
  const answer = { askId: ask.id, optionId: 'team', answerer: { deviceId: 'phone' } };
  const { ask: answered } = h.desk.answer(answer);
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answeredByDeviceId, 'phone');
  assert.equal(h.presented.some((entry) => entry.type === 'ask_answered'), true);
  closed(() => h.desk.answer({ askId: ask.id, optionId: 'boss', answerer: { deviceId: 'laptop' } }), 'ask_closed');
});

test('没有的选项、或没有选项的卡不写字：拒绝，卡还开着', () => {
  const ask = raise();
  closed(() => h.desk.answer({ askId: ask.id, optionId: 'nobody', answerer: { deviceId: 'phone' } }), 'invalid_answer');
  const open = raise({ options: [], question: '地址写哪里？' });
  closed(() => h.desk.answer({ askId: open.id, answerer: { deviceId: 'phone' } }), 'invalid_answer');
  const typed = h.desk.answer({ askId: open.id, text: '公司前台', answerer: { deviceId: 'phone' } });
  assert.equal(typed.ask.status, 'answered');
  assert.equal(h.state.asks.get(ask.id)?.status, 'open');
});

test('作答带来的后果出错时，答卡也一起回滚：卡还开着', () => {
  const ask = raise();
  h.desk.setResolver({
    resolve() {
      throw new Error('任务那边写不进去');
    },
  });
  assert.throws(() => h.desk.answer({ askId: ask.id, optionId: 'team', answerer: { deviceId: 'phone' } }));
  assert.equal(h.state.asks.get(ask.id)?.status, 'open');
});

test('先不：卡收回清单但仍开着；摊开的换成下一张', () => {
  const first = raise({ question: '第一张' });
  const second = raise({ question: '第二张' });
  assert.equal(h.desk.board().current?.id, first.id);
  const deferred = h.desk.defer(first.id);
  assert.notEqual(deferred.deferredAt, null);
  const board = h.desk.board();
  assert.equal(board.current?.id, second.id);
  assert.deepEqual(board.queue, []);
  assert.deepEqual(board, { current: h.desk.get(second.id), queue: [], deferred: [deferred] });
  assert.equal(deferred.status, 'open');
  assert.equal(deferred.answer, null);
});

test('一次只摊开一张：立刻打断的排在最前；下次汇报档的卡不摊开、排在等你最后', () => {
  const popup = raise({ question: '弹框' });
  const later = raise({ question: '采访', channel: 'next_report', kind: 'act' });
  const urgent = raise({ question: '马上', channel: 'interrupt', kind: 'decide' });
  const board = h.desk.board();
  assert.equal(board.current?.id, urgent.id);
  assert.deepEqual(board.queue.map((ask) => ask.id), [popup.id, later.id]);
});

test('独立卡暂缓后不再摊开或重复推送，延迟到达的出卡展示也不催答', async () => {
  const notified: string[] = [];
  h.presenter.setNotifier({ notify: async (ask) => { notified.push(ask.id); } });
  let present: (() => void) | undefined;
  const ask = h.desk.commit((changes) => h.desk.raise(changes, card({ channel: 'interrupt' })),
    (after) => { present = after; });
  h.desk.defer(ask.id);
  present?.();
  await h.presenter.settled();
  assert.deepEqual(notified, []);
  assert.equal(h.desk.board().current, null);
  assert.deepEqual(h.desk.board().queue, []);
});

test('渠道：没说就弹框；说了就照它', () => {
  assert.equal(channelForAsk('line_question', undefined), 'popup');
  assert.equal(channelForAsk('line_question', 'next_report'), 'next_report');
});
