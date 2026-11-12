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

test('回顾写完：记上次；信里标了值得跟进的每一条出一张建议，同一期不重复', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed, lines, suggested } = setup(now);
  timed.tick(now.at);
  now.at = new Date('2026-11-08T08:00:00+08:00');
  timed.tick(now.at);
  writeSpace(t.state, { title: '悬赏规则定了', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    genre: 'letter', html: '<p class="lt-lead">昨天定了悬赏规则，还差验收一节。</p><ul>'
      + '<li data-follow>把<b>验收</b>一节写完</li><li data-follow>约赵一舟聊合作</li></ul>' }, 'ai');
  lines.views.set('line-1', { status: 'idle', outcome: 'done', lastAnswer: '日报写好了' });
  timed.ended('line-1');
  const slot = t.state.timedSlots.require('review:daily');
  assert.equal(slot.lastOutcome, 'done');
  assert.deepEqual(suggested.map((item) => [item.title, item.source]), [['把验收一节写完', 'review'],
    ['约赵一舟聊合作', 'review']]);
  assert.match(suggested[0]?.key ?? '', /^review:.+:1$/);
});

test('两台设备时区来回切（11-12 漏发）：日报照北京 08:00 出，不被推到明天', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const zone = { name: 'Asia/Shanghai' };
  const now = { at: new Date('2026-11-11T10:00:00+08:00') };
  const lines = fakeLines();
  const timed = new SubscriptionTimed({ state: t.state, lines, now: () => now.at, zone: () => zone.name });
  timed.tick(now.at);
  // 夜里先被切到芝加哥，又切回北京。
  for (const [at, name] of [['2026-11-12T07:30:00+08:00', 'America/Chicago'],
    ['2026-11-12T07:40:00+08:00', 'Asia/Shanghai'], ['2026-11-12T07:50:00+08:00', 'America/Chicago']] as const) {
    now.at = new Date(at);
    zone.name = name;
    timed.tick(now.at);
  }
  now.at = new Date('2026-11-12T08:00:00+08:00');
  timed.tick(now.at);
  assert.equal(lines.opened.length, 1);
  assert.equal(t.state.timedSlots.get('review:daily')?.lastRunAt, new Date('2026-11-12T08:00:00+08:00').toISOString());
});

test('心跳查漏发：本该出、过了一小时没出的补一期；出过的、刚建的不补', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-11T10:00:00+08:00') };
  const { timed, lines } = setup(now);
  timed.tick(now.at);
  // 下一次被挪到了后天（像 11-12 那样），今天 08:00 那一期没出。
  const slot = t.state.timedSlots.get('review:daily');
  assert.ok(slot !== undefined);
  t.state.timedSlots.update(slot.id, slot.version, { nextAt: new Date('2026-11-13T08:00:00+08:00').toISOString(),
    lastRunAt: new Date('2026-11-10T08:00:00+08:00').toISOString() });
  now.at = new Date('2026-11-12T09:30:00+08:00');
  assert.deepEqual(timed.catchUp(now.at, 60 * 60_000), ['日报']);
  assert.equal(lines.opened.length, 1);
  const after = t.state.timedSlots.get('review:daily');
  assert.equal(after?.lastRunAt, new Date('2026-11-12T08:00:00+08:00').toISOString());
  assert.equal(after?.nextAt, new Date('2026-11-13T08:00:00+08:00').toISOString());
  assert.deepEqual(timed.catchUp(now.at, 60 * 60_000), []);
});
