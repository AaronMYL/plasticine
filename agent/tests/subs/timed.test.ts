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

test('Schedule lists daily/weekly personal reviews and research weekly in local time', () => {
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

test('Due daily posts to review line; missed 3 days catches up latest once; skips early', () => {
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

test('Skips current issue with reason if previous issue is still in progress', () => {
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

test('Stopping daily toggles setting; deleting weekly pauses sub keeping past issues', () => {
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

test('Finished review logs last run and creates one suggestion per data-follow item', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-07T10:00:00+08:00') };
  const { timed, lines, suggested } = setup(now);
  timed.tick(now.at);
  now.at = new Date('2026-11-08T08:00:00+08:00');
  timed.tick(now.at);
  writeSpace(t.state, { title: '悬赏规则定了', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    genre: 'letter', html: '<p class="lt-lead">昨天定了悬赏规则，还差验收一节。</p><ul>'
      + '<li data-follow>把<b>验收</b>一节写完</li><li data-follow>最后，约赵一舟聊合作</li>'
      + '<li data-follow>另外：</li><li data-follow>3．补读两篇原文</li><li data-follow>第四条不该再提出来</li></ul>' },
  'ai');
  lines.views.set('line-1', { status: 'idle', outcome: 'done', lastAnswer: '日报写好了' });
  timed.ended('line-1');
  const slot = t.state.timedSlots.require('review:daily');
  assert.equal(slot.lastOutcome, 'done');
  assert.deepEqual(suggested.map((item) => [item.title, item.source]), [['把验收一节写完', 'review'],
    ['约赵一舟聊合作', 'review'], ['补读两篇原文', 'review']]);
  assert.match(suggested[0]?.key ?? '', /^review:.+:1$/);
  assert.match(suggested[2]?.key ?? '', /^review:.+:4$/);
  assert.equal(suggested[0]?.why, '来自回顾日报《悬赏规则定了》');
  assert.match(suggested[0]?.goal ?? '', /^回顾《悬赏规则定了》里「值得跟进」的一条：把验收一节写完\n先读这一期（space:.+）/);
});

test('Timezone flip between two devices still fires daily at 08:00 Beijing not next day', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const zone = { name: 'Asia/Shanghai' };
  const now = { at: new Date('2026-11-11T10:00:00+08:00') };
  const lines = fakeLines();
  const timed = new SubscriptionTimed({ state: t.state, lines, now: () => now.at, zone: () => zone.name });
  timed.tick(now.at);
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

test('Heartbeat catches up issue missed by >1h; skips already-sent or newly created', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-11-11T10:00:00+08:00') };
  const { timed, lines } = setup(now);
  timed.tick(now.at);
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

test('Heartbeat skips catch-up when manual run-now already produced the current issue', () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const now = { at: new Date('2026-10-27T16:30:00+08:00') };
  const { timed, lines } = setup(now);
  timed.tick(now.at);
  writeSpace(t.state, { title: '今天的信', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    genre: 'letter', html: '<p class="lt-lead">手动出的一期。</p><ul><li data-follow>把验收一节写完</li></ul>' }, 'ai');
  const slot = t.state.timedSlots.require('review:daily');
  t.state.timedSlots.update(slot.id, slot.version, { nextAt: new Date('2026-10-29T08:00:00+08:00').toISOString() });
  now.at = new Date('2026-10-28T10:00:00+08:00');
  assert.deepEqual(timed.catchUp(now.at, 60 * 60_000), []);
  assert.equal(lines.opened.length, 0);
});
