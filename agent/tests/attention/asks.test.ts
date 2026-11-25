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

test('emit card puts recommended option first, dedupes by actionId, pushes only after commit', () => {
  const ask = raise({ actionId: 'act-1' });
  assert.deepEqual(ask.options.map((option) => [option.id, option.recommended]), [['boss', true], ['team', false]]);
  assert.equal(raise({ actionId: 'act-1', question: '换了说法' }).id, ask.id);
  assert.equal(h.state.asks.open().length, 1);
  const created = h.presented.filter((entry) => entry.type === 'ask_created');
  assert.equal(created.length, 1);
});

test('rolled-back card transaction leaves no card and pushes no event', () => {
  assert.throws(() =>
    h.desk.commit((changes) => {
      h.desk.raise(changes, card());
      throw new Error('后面一步失败了');
    }),
  );
  assert.equal(h.state.asks.open().length, 0);
  assert.equal(h.presented.length, 0);
});

test('card allows at most one recommended option and forbids duplicate option IDs', () => {
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

test('answering records who/when without extra choice msg; second device answer returns ask_closed', () => {
  const ask = raise();
  const answer = { askId: ask.id, optionId: 'team', answerer: { deviceId: 'phone' } };
  const { ask: answered } = h.desk.answer(answer);
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answeredByDeviceId, 'phone');
  assert.equal(h.presented.some((entry) => entry.type === 'ask_answered'), true);
  closed(() => h.desk.answer({ askId: ask.id, optionId: 'boss', answerer: { deviceId: 'laptop' } }), 'ask_closed');
});

test('invalid option or blank text on free-form card is rejected leaving card open', () => {
  const ask = raise();
  closed(() => h.desk.answer({ askId: ask.id, optionId: 'nobody', answerer: { deviceId: 'phone' } }), 'invalid_answer');
  const open = raise({ options: [], question: '地址写哪里？' });
  closed(() => h.desk.answer({ askId: open.id, answerer: { deviceId: 'phone' } }), 'invalid_answer');
  const typed = h.desk.answer({ askId: open.id, text: '公司前台', answerer: { deviceId: 'phone' } });
  assert.equal(typed.ask.status, 'answered');
  assert.equal(h.state.asks.get(ask.id)?.status, 'open');
});

test('if card answer side-effect fails, answer rolls back leaving card open', () => {
  const ask = raise();
  h.desk.setResolver({
    resolve() {
      throw new Error('任务那边写不进去');
    },
  });
  assert.throws(() => h.desk.answer({ askId: ask.id, optionId: 'team', answerer: { deviceId: 'phone' } }));
  assert.equal(h.state.asks.get(ask.id)?.status, 'open');
});

test('defer returns card to list while keeping open and expands next card', () => {
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

test('only one card expands at a time: immediate-interrupt first; next-report unexpanded at end', () => {
  const popup = raise({ question: '弹框' });
  const later = raise({ question: '采访', channel: 'next_report', kind: 'act' });
  const urgent = raise({ question: '马上', channel: 'interrupt', kind: 'decide' });
  const board = h.desk.board();
  assert.equal(board.current?.id, urgent.id);
  assert.deepEqual(board.queue.map((ask) => ask.id), [popup.id, later.id]);
});

test('deferred standalone card does not re-expand or re-push; delayed display does not nag', async () => {
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

test('delivery channel defaults to modal when unspecified and honors explicit channel', () => {
  assert.equal(channelForAsk('line_question', undefined), 'popup');
  assert.equal(channelForAsk('line_question', 'next_report'), 'next_report');
});
