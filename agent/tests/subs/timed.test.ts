// 订阅登记进「定时」（第 3、6、7 条接线）：每分钟看一眼到点就出一期、错过补最近一次、上一期没写完跳过、
// 暂停 / 删（删 = 关掉订阅，往期都在）、回顾写完「值得跟进」进建议。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { LineView } from '../../shared/api/index.ts';
import { ensureReviewSubscription, REVIEW_SUBSCRIPTION_ID, researchDraft, SubscriptionTimed, writeSpace,
  type SubsTimedLines } from '../../src/subs/index.ts';
import type { SuggestionInputDraft } from '../../src/tasks/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

interface FakeLines extends SubsTimedLines {
  opened: { title: string; purpose: string; goal: string }[];
  told: string[];
  views: Map<string, Partial<LineView>>;
  halted: string[];
}

function fakeLines(): FakeLines {
  const opened: FakeLines['opened'] = [];
  const told: string[] = [];
  const views = new Map<string, Partial<LineView>>();
  const halted: string[] = [];
  return {
    opened, told, views, halted,
    port: () => ({
      open(input) {
        opened.push({ title: input.title, purpose: input.purpose, goal: input.goal });
        const id = `line-${opened.length}`;
        views.set(id, { status: 'queued' });
        return id;
      },
      tell(lineId, text) {
        told.push(text);
        views.set(lineId, { status: 'queued' });
        return true;
      },
    }),
    view: (lineId) => (views.has(lineId) ? { status: 'idle', outcome: null, unmet: null, lastAnswer: null,
      failure: null, activity: null, ...views.get(lineId) } as LineView : null),
    halt: (lineId) => {
      halted.push(lineId);
    },
  };
}

function setup(now: { at: Date }, lines = fakeLines(), suggested: SuggestionInputDraft[] = []) {
  const timed = new SubscriptionTimed({ state: t.state, lines, now: () => now.at, zone: () => 'Asia/Shanghai',
    suggest: (input) => suggested.push(input) });
  return { timed, lines, suggested };
}

test('个人回顾在「定时」里是日报、周报两行，研究周报一行；下次按他所在地的钟点', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  t.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'active',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['睡眠'] }) });
  t.state.subscriptions.create({ title: '还在草案', kind: 'research', status: 'draft', timeZone: 'Asia/Shanghai',
    settings: researchDraft({}) });
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed } = setup(now);
  timed.tick(now.at);
  const review = timed.rows('review');
  assert.deepEqual(review.map((row) => [row.id, row.title, row.summary]), [
    ['review:daily', '日报', '每天 08:00 · 个人回顾'], ['review:weekly', '周报', '周日 21:00 · 个人回顾']]);
  assert.equal(review[0]?.nextAt, new Date('2026-11-08T08:00:00+08:00').toISOString());
  assert.equal(review[1]?.nextAt, new Date('2026-11-08T21:00:00+08:00').toISOString());
  const research = timed.rows('subscription');
  assert.deepEqual(research.map((row) => [row.title, row.summary, row.teammateId]),
    [['认知与神经科学研究周报', '周一 09:00 · 订阅', 'researcher']]);
});

test('到点：日报放进回顾的线（review 模型）；关机错过三天只补最近一次；没到点不动', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed, lines } = setup(now);
  timed.tick(now.at);
  now.at = new Date('2026-11-08T07:59:00+08:00');
  timed.tick(now.at);
  assert.equal(lines.opened.length, 0);
  now.at = new Date('2026-11-11T09:30:00+08:00');
  timed.tick(now.at);
  assert.equal(lines.opened.length, 1);
  assert.equal(lines.opened[0]?.purpose, 'review');
  assert.match(lines.opened[0]?.goal ?? '', /日报/);
  const slot = t.state.timedSlots.require('review:daily');
  assert.equal(slot.lastRunAt, new Date('2026-11-11T08:00:00+08:00').toISOString());
  assert.equal(slot.nextAt, new Date('2026-11-12T08:00:00+08:00').toISOString());
  assert.equal(slot.lineId, 'line-1');
  timed.tick(now.at);
  assert.equal(lines.opened.length + lines.told.length, 1, '同一次不放第二遍');
});

test('上一期还没写完：这一次跳过，上次写原因', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed, lines } = setup(now);
  timed.tick(now.at);
  now.at = new Date('2026-11-08T08:00:00+08:00');
  timed.tick(now.at);
  now.at = new Date('2026-11-09T08:00:00+08:00');
  timed.tick(now.at);
  assert.equal(lines.told.length, 0);
  const row = timed.rows('review')[0];
  assert.equal(t.state.timedSlots.require('review:daily').lastOutcome, 'skipped');
  assert.equal(row?.last?.glyph, 'run');
});

test('停下日报 = 回顾设置里关掉日报；删研究周报 = 订阅暂停、这一行不再列出，往期留着', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const research = t.state.subscriptions.create({ title: '周报', kind: 'research', status: 'active',
    timeZone: 'Asia/Shanghai', settings: researchDraft({}) });
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed } = setup(now);
  timed.tick(now.at);
  timed.setEnabled('review:daily', false);
  const review = t.state.subscriptions.require(REVIEW_SUBSCRIPTION_ID);
  assert.equal(review.settings.kind === 'review' && review.settings.daily.on, false);
  assert.equal(timed.rows('review')[0]?.enabled, false);
  assert.equal(timed.rows('review')[0]?.nextAt, null);
  timed.setEnabled('review:daily', true);
  assert.equal(timed.rows('review')[0]?.nextAt, new Date('2026-11-08T08:00:00+08:00').toISOString());
  timed.remove(`subscription:${research.id}`);
  assert.equal(t.state.subscriptions.require(research.id).status, 'paused');
  assert.deepEqual(timed.rows('subscription'), []);
});

test('回顾写完：记上次；「值得跟进」里每一条出一张建议，同一期不重复', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed, lines, suggested } = setup(now);
  timed.tick(now.at);
  now.at = new Date('2026-11-08T08:00:00+08:00');
  timed.tick(now.at);
  writeSpace(t.state, { title: '日报 11月8日', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    doc: { stats: [], sources: [{ label: '11月8日的对话' }], blocks: [
      { type: 'heading', id: 'talk', text: '来自交流' }, { type: 'text', markdown: '定了悬赏规则。' },
      { type: 'heading', id: 'next', text: '值得跟进' },
      { type: 'text', markdown: '- 把**验收**一节写完[^1]\n- 约赵一舟聊合作' }] } }, 'ai');
  lines.views.set('line-1', { status: 'idle', outcome: 'done', lastAnswer: '日报写好了' });
  timed.ended('line-1');
  const slot = t.state.timedSlots.require('review:daily');
  assert.equal(slot.lastOutcome, 'done');
  assert.deepEqual(suggested.map((item) => [item.title, item.source]), [['把验收一节写完', 'review'],
    ['约赵一舟聊合作', 'review']]);
  assert.match(suggested[0]?.key ?? '', /^review:.+:1$/);
});
