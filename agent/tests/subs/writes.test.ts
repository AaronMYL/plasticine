// 空间和订阅的写（第 6、7 条；第 8 批第 6 条起空间是整页网页）：Plasticine 写一页、样刊、单期修改和「以后都这样」
// 分开、开定时要先有样刊；来信只给个人回顾；「找原文 → 换新文」的补丁。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { adoptRule, changeSubscription, editSpace, ensureReviewSubscription, researchDraft, REVIEW_SUBSCRIPTION_ID,
  SubsError, writeSpace } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const REPORT = '<header class="rp-hero"><h1 class="rp-h1">本周最值得看的：睡眠中的记忆重放</h1></header>'
  + '<section class="rp-sec" id="overview"><h2>本周概览</h2><p>重放越多，第二天记得越牢。</p></section>';
const LETTER = '<p class="lt-lead">你定的「做梦」，今天信息流里正好有一篇能对上的原文。</p><p>下一步，今晚我先试一次。</p>';

function draft() {
  return t.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'draft',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['睡眠'] }) });
}

test('Plasticine 写一页报告：正文先清洗（外链脚本、iframe 去掉并说清楚），空的不存', () => {
  assert.throws(() => writeSpace(t.state, { title: '核查', genre: 'report', html: '<div></div>' }, 'ai'), SubsError);
  assert.equal(t.state.spaces.list().length, 0);
  const { space, removed } = writeSpace(t.state, { title: '马来西亚签证核查', genre: 'report',
    html: `${REPORT}<script src="https://evil.example/x.js"></script><iframe src="https://x"></iframe>` }, 'ai');
  assert.equal(space.author, 'ai');
  assert.equal(space.genre, 'report');
  assert.equal(space.html, REPORT);
  assert.deepEqual(removed, ['外链脚本 1 处', 'iframe 元素 1 处']);
  assert.deepEqual(space.doc, { stats: [], blocks: [], sources: [] });
});

test('新空间要写体裁和正文', () => {
  assert.throws(() => writeSpace(t.state, { title: '核查', html: REPORT }, 'ai'), /genre/);
});

test('草案出的第一期是样刊：期号 1，订阅进入 sample；没出样刊不能开定时', () => {
  const sub = draft();
  assert.throws(() => changeSubscription(t.state, sub.id, sub.version, { status: 'active' }),
    (error) => error instanceof SubsError && error.code === 'conflict');
  const issue = writeSpace(t.state, { title: '第 1 期', genre: 'report', html: REPORT, subscriptionId: sub.id }, 'ai');
  assert.equal(issue.space.issueNumber, 1);
  const sampled = t.state.subscriptions.require(sub.id);
  assert.equal(sampled.status, 'sample');
  assert.equal(changeSubscription(t.state, sub.id, sampled.version, { status: 'active' }).status, 'active');
  assert.equal(writeSpace(t.state, { title: '第 2 期', genre: 'report', html: REPORT, subscriptionId: sub.id }, 'ai')
    .space.issueNumber, 2);
});

test('「这一期少放点图」只改这一期；点了「以后都这样」才写进订阅设置，记着是第几期加的，同一句不重复加', () => {
  const sub = draft();
  const { space: issue } = writeSpace(t.state, { title: '第 1 期', genre: 'report', html: REPORT,
    subscriptionId: sub.id }, 'ai');
  const { space: edited } = writeSpace(t.state, { id: issue.id, version: issue.version, title: '第 1 期',
    html: REPORT.replace('本周概览', '概览'), change: '图从 4 张减到 1 张', rule: '每期最多 1 张图' }, 'ai');
  assert.equal(edited.genre, 'report');
  assert.deepEqual(t.state.subscriptions.require(sub.id).settings.rules, []);
  const current = t.state.subscriptions.require(sub.id);
  const adopted = adoptRule(t.state, sub.id, current.version, issue.id, edited.version, '2026-11-07T08:00:00.000Z');
  assert.deepEqual(adopted.settings.rules, [{ text: '每期最多 1 张图', fromIssue: 1,
    addedAt: '2026-11-07T08:00:00.000Z' }]);
  const again = adoptRule(t.state, sub.id, adopted.version, issue.id, edited.version, '2026-11-07T09:00:00.000Z');
  assert.equal(again.settings.rules.length, 1);
  assert.throws(() => adoptRule(t.state, sub.id, again.version, issue.id, 1, '2026-11-07T09:00:00.000Z'), SubsError);
});

test('个人回顾的一期要说日报还是周报，写成来信；个人回顾只建一个、默认开着（日报 8 点、周报周日晚上）', () => {
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  assert.equal(review.id, REVIEW_SUBSCRIPTION_ID);
  assert.equal(review.status, 'active');
  assert.equal(ensureReviewSubscription(t.state, 'Europe/London').timeZone, 'Asia/Shanghai');
  assert.throws(() => writeSpace(t.state, { title: '做梦，有了一组数字', genre: 'letter', html: LETTER,
    subscriptionId: review.id }, 'ai'), SubsError);
  const daily = writeSpace(t.state, { title: '做梦，有了一组数字', genre: 'letter', html: LETTER,
    subscriptionId: review.id, edition: 'daily' }, 'ai');
  assert.equal(daily.space.edition, 'daily');
  assert.equal(daily.space.genre, 'letter');
});

test('来信只给个人回顾：独立的空间、研究周报不能写成来信；来信正文里不写 h1（题目由信纸套上）', () => {
  const sub = draft();
  assert.throws(() => writeSpace(t.state, { title: '信', genre: 'letter', html: LETTER }, 'ai'), /个人回顾/);
  assert.throws(() => writeSpace(t.state, { title: '信', genre: 'letter', html: LETTER, subscriptionId: sub.id },
    'ai'), /个人回顾/);
  const report = writeSpace(t.state, { title: '核查', genre: 'report', html: REPORT }, 'ai').space;
  assert.throws(() => writeSpace(t.state, { id: report.id, version: report.version, title: '核查', genre: 'letter',
    html: LETTER }, 'ai'), /个人回顾/);
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  assert.throws(() => writeSpace(t.state, { title: '信', genre: 'letter', html: `<h1>题目</h1>${LETTER}`,
    subscriptionId: review.id, edition: 'daily' }, 'ai'), /h1/);
});

test('改名只给标题：正文和体裁照旧，记成新的一版', () => {
  const { space } = writeSpace(t.state, { title: '核查', genre: 'report', html: REPORT }, 'ai');
  const renamed = writeSpace(t.state, { id: space.id, version: space.version, title: '签证核查' }, 'user').space;
  assert.equal(renamed.title, '签证核查');
  assert.equal(renamed.html, REPORT);
  assert.equal(renamed.version, 2);
  assert.equal(t.state.spaces.revision(space.id, 2)?.html, REPORT);
});

test('找原文 → 换新文：原文对不上或不止一处就整个不改；换好的照样清洗、记一版', () => {
  const { space } = writeSpace(t.state, { title: '核查', genre: 'report', html: REPORT }, 'ai');
  assert.throws(() => editSpace(t.state, { id: space.id, version: 1, edits: [{ oldText: '没有这句', newText: 'x' }] },
    'ai'), /找不到/);
  assert.throws(() => editSpace(t.state, { id: space.id, version: 1, edits: [{ oldText: '</h', newText: '</p' }] },
    'ai'), /出现了 3 次/);
  assert.equal(t.state.spaces.require(space.id).version, 1);
  const edited = editSpace(t.state, { id: space.id, version: 1, change: '结论改短', edits: [
    { oldText: '本周最值得看的：', newText: '' },
    { oldText: '<p>重放越多', newText: '<p onclick="x()">重放越多' },
    { oldText: '</section>', newText: '<iframe src="https://x"></iframe></section>' },
  ] }, 'ai');
  assert.match(edited.space.html ?? '', /<h1 class="rp-h1">睡眠中的记忆重放<\/h1>/);
  assert.match(edited.space.html ?? '', /onclick="x\(\)"/);
  assert.doesNotMatch(edited.space.html ?? '', /iframe/);
  assert.deepEqual(edited.removed, ['iframe 元素 1 处']);
  assert.equal(t.state.spaces.revision(space.id, 2)?.change, '结论改短');
  assert.throws(() => editSpace(t.state, { id: space.id, version: 1, edits: [{ oldText: '睡眠', newText: '梦' }] },
    'ai'), (error) => error instanceof SubsError && error.code === 'conflict');
});

test('撤销把上一版的网页正文和体裁带回来', () => {
  const { space } = writeSpace(t.state, { title: '核查', genre: 'report', html: REPORT }, 'ai');
  writeSpace(t.state, { id: space.id, version: 1, title: '核查', html: `${REPORT}<p>补一段新的说明文字。</p>` }, 'user');
  const undone = t.state.spaces.undo(space.id, 2, 'user');
  assert.equal(undone.html, REPORT);
  assert.equal(undone.genre, 'report');
});

test('订阅的种类不能改', () => {
  const sub = draft();
  const review = ensureReviewSubscription(t.state, 'Asia/Shanghai');
  assert.throws(() => changeSubscription(t.state, sub.id, sub.version, { settings: review.settings }), SubsError);
});
