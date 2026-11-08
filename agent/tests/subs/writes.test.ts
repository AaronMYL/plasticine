// 空间和订阅的写（第 6、7 条）：Plasticine 写一期、样刊、单期修改和「以后都这样」分开、开定时要先有样刊。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { SpaceDoc } from '../../shared/state.ts';
import { adoptRule, changeSubscription, ensureReviewSubscription, researchDraft, REVIEW_SUBSCRIPTION_ID, SubsError,
  writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const DOC: SpaceDoc = { headline: '本周最值得看的', stats: [], blocks: [{ type: 'text', markdown: '正文' }], sources: [] };

function draft() {
  return t.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'draft',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['睡眠'] }) });
}

test('Plasticine 写一个空间：正文先核对，不合规（[^1] 没出处）就不存', () => {
  assert.throws(() => writeSpace(t.state, { title: '核查', doc: { ...DOC, blocks: [{ type: 'text',
    markdown: '说法[^1]' }] } }, 'ai'), SubsError);
  assert.equal(t.state.spaces.list().length, 0);
  const space = writeSpace(t.state, { title: '马来西亚签证核查', doc: DOC }, 'ai');
  assert.equal(space.author, 'ai');
});

test('草案出的第一期是样刊：期号 1，订阅进入 sample；没出样刊不能开定时', () => {
  const sub = draft();
  assert.throws(() => changeSubscription(t.state, sub.id, sub.version, { status: 'active' }),
    (error) => error instanceof SubsError && error.code === 'conflict');
  const issue = writeSpace(t.state, { title: '第 1 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  assert.equal(issue.issueNumber, 1);
  const sampled = t.state.subscriptions.require(sub.id);
  assert.equal(sampled.status, 'sample');
  assert.equal(changeSubscription(t.state, sub.id, sampled.version, { status: 'active' }).status, 'active');
  assert.equal(writeSpace(t.state, { title: '第 2 期', doc: DOC, subscriptionId: sub.id }, 'ai').issueNumber, 2);
});

test('「这一期少放点图」只改这一期；点了「以后都这样」才写进订阅设置，记着是第几期加的，同一句不重复加', () => {
  const sub = draft();
  const issue = writeSpace(t.state, { title: '第 1 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  const edited = writeSpace(t.state, { id: issue.id, version: issue.version, title: '第 1 期',
    doc: { ...DOC, headline: '改过' }, change: '图从 4 张减到 1 张', rule: '每期最多 1 张图' }, 'ai');
  assert.deepEqual(t.state.subscriptions.require(sub.id).settings.rules, []);
  const current = t.state.subscriptions.require(sub.id);
  const adopted = adoptRule(t.state, sub.id, current.version, issue.id, edited.version, '2026-11-07T08:00:00.000Z');
  assert.deepEqual(adopted.settings.rules, [{ text: '每期最多 1 张图', fromIssue: 1,
    addedAt: '2026-11-07T08:00:00.000Z' }]);
  const again = adoptRule(t.state, sub.id, adopted.version, issue.id, edited.version, '2026-11-07T09:00:00.000Z');
  assert.equal(again.settings.rules.length, 1);
  assert.throws(() => adoptRule(t.state, sub.id, again.version, issue.id, 1, '2026-11-07T09:00:00.000Z'), SubsError);
});

test('个人回顾的一期要说日报还是周报；个人回顾只建一个、默认开着（日报 8 点、周报周日晚上）', () => {
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  assert.equal(review.id, REVIEW_SUBSCRIPTION_ID);
  assert.equal(review.status, 'active');
  assert.equal(ensureReviewSubscription(t.state, 'Europe/London').timeZone, 'Asia/Shanghai');
  assert.throws(() => writeSpace(t.state, { title: '日报', doc: DOC, subscriptionId: review.id }, 'ai'), SubsError);
  const daily = writeSpace(t.state, { title: '日报 · 11月7日', doc: DOC, subscriptionId: review.id,
    edition: 'daily' }, 'ai');
  assert.equal(daily.edition, 'daily');
});

test('订阅的种类不能改', () => {
  const sub = draft();
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  assert.throws(() => changeSubscription(t.state, sub.id, sub.version, { settings: review.settings }), SubsError);
});
