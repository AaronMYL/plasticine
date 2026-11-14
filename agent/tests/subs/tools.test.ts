// 给模型的空间与订阅工具（第 6、7 条）：从一句话到草案、样刊、按反馈调、开定时。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Space } from '../../shared/state.ts';
import type { KernelTool } from '../../src/lines/index.ts';
import { ensureReviewSubscription, REVIEW_SUBSCRIPTION_ID, subsTools, type RunPort } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let opened: string[];
beforeEach(async () => { t = await openTestState(); opened = []; });
afterEach(async () => { await t.cleanup(); });

const PORT: RunPort = {
  open(input) {
    opened.push(input.goal);
    return 'line-sub';
  },
  tell: () => true,
};

const REPORT = '<header class="rp-hero"><h1 class="rp-h1">睡眠中的记忆重放</h1></header><p>本周读了十四篇。</p>';
const LETTER = '<p class="lt-lead">你定的「做梦」，今天信息流里正好有一篇能对上。</p>'
  + '<figure class="lt-fig" data-illustrate="夜里，散落的便签连成一张网"><figcaption>夜里回看原话。</figcaption></figure>'
  + '<p>下一步，今晚我先拿《我的理论用词》试一次。</p>';

async function call(tools: KernelTool[], name: string, args: unknown): Promise<Record<string, unknown>> {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, name);
  const result = await found.create({ lineId: 'line-main', kind: 'main', projectId: null }).execute('call-1',
    args as never);
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.type === 'text' ? first.text : '{}') as Record<string, unknown>;
}

test('「我想要一个认知与神经科学的研究周报」：草案带默认结构、列出要追问的缺口；样刊、按反馈调、开定时', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date('2026-11-07T08:00:00Z'));
  const draft = await call(tools, 'subscription_draft', { title: '认知与神经科学研究周报', topics: ['睡眠'] });
  assert.deepEqual(draft['gaps'], ['基础还是临床', '专业还是科普']);
  const id = String(draft['id']);
  assert.equal(t.state.subscriptions.require(id).timeZone, 'Asia/Shanghai');
  await call(tools, 'subscription_run', { id });
  assert.match(opened[0] ?? '', /第 1 期/);
  const issue = await call(tools, 'space_write', { title: '研究周报 · 第 1 期', subscriptionId: id, genre: 'report',
    html: REPORT });
  assert.equal(issue['issueNumber'], 1);
  assert.equal(issue['link'], `#/books/space/${String(issue['id'])}`);
  const sampled = t.state.subscriptions.require(id);
  assert.equal(sampled.status, 'sample');
  const tuned = await call(tools, 'subscription_update', { id, version: sampled.version,
    settings: { focus: 'basic', depth: 'expert' } });
  const active = await call(tools, 'subscription_update', { id, version: Number(tuned['version']), status: 'active' });
  assert.equal(active['status'], 'active');
  const settings = t.state.subscriptions.require(id).settings;
  assert.equal(settings.kind === 'research' ? settings.focus : null, 'basic');
});

test('space_write 不合规（没写正文）就报一句能照着改的话；去掉了什么回给模型', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date());
  await assert.rejects(call(tools, 'space_write', { title: '核查', genre: 'report', html: '<div> </div>' }), /空的/);
  const written = await call(tools, 'space_write', { title: '核查', genre: 'report',
    html: `${REPORT}<script src="https://x/a.js"></script>` });
  assert.deepEqual(written['removed'], ['外链脚本 1 处']);
  assert.equal(written['genre'], 'report');
});

test('个人回顾写成来信：插图照画面描述出好、存成资产，主线发一句带来信卡；出不了图就不配', async () => {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const letters: [string, string][] = [];
  const lettered = (space: Space, say: string): void => {
    letters.push([space.title, say]);
  };
  const tools = subsTools(t.state, () => PORT, () => new Date(), undefined, { lettered, saveAsset: () => 'a1.webp',
    illustrator: { draw: async () => ({ data: Buffer.from('x'), mime: 'image/webp' }) } });
  const letter = await call(tools, 'space_write', { title: '做梦，有了一组数字', genre: 'letter', html: LETTER,
    subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily', say: '给你写了一封信：你定的「做梦」有了一组数字。' });
  assert.equal(letter['illustration'], '配好了');
  const space = t.state.spaces.require(String(letter['id']));
  assert.match(space.html ?? '', /<img src="\/v2\/notes\/assets\/a1\.webp"/);
  assert.match(space.html ?? '', /<span class="lt-ai" role="img" aria-label="AI 生成" title="AI 生成"><\/span>/);
  assert.doesNotMatch(space.html ?? '', /Plasticine 生成/);
  assert.deepEqual(letters, [['做梦，有了一组数字', '给你写了一封信：你定的「做梦」有了一组数字。']]);
  const plain = subsTools(t.state, () => PORT, () => new Date(), undefined, { lettered });
  const second = await call(plain, 'space_write', { title: '周日的信', genre: 'letter', html: LETTER,
    subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'weekly' });
  assert.equal(second['illustration'], '没配：这台 Plasticine 没有能出图的模型');
  assert.doesNotMatch(t.state.spaces.require(String(second['id'])).html ?? '', /figure/);
  assert.deepEqual(letters[1], ['周日的信', '给你写了一封信：《周日的信》。']);
  await call(plain, 'space_write', { id: String(second['id']), version: 1, title: '周日的信', html: LETTER });
  assert.equal(letters.length, 2);
});

test('space_edit 找原文换新文；space_read 给网页正文和体裁', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date());
  const written = await call(tools, 'space_write', { title: '核查', genre: 'report', html: REPORT });
  const id = String(written['id']);
  const edited = await call(tools, 'space_edit', { id, version: 1, change: '改了数字',
    edits: [{ old_text: '十四篇', new_text: '十五篇' }] });
  assert.equal(edited['version'], 2);
  assert.equal(edited['title'], '核查');
  assert.equal(edited['change'], '改了数字');
  assert.equal(t.state.spaces.revision(id, 2)?.lineId, 'line-main');
  t.state.spaces.save(id, 2, { title: '自己改的标题' }, 'user');
  assert.equal(t.state.spaces.revision(id, 3)?.lineId, null);
  const read = await call(tools, 'space_read', { id });
  assert.equal(read['genre'], 'report');
  assert.match(String(read['html']), /十五篇/);
  assert.equal(read['doc'], undefined);
  await assert.rejects(call(tools, 'space_edit', { id, version: 3, edits: [{ old_text: '十四篇', new_text: '' }] }),
    /找不到/);
});

test('他删了的空间：space_list 不列，space_read 明说已删除，space_write 改它要先还原', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date());
  const written = await call(tools, 'space_write', { title: '签证核查', genre: 'report', html: REPORT });
  const id = String(written['id']);
  t.state.spaces.markDeleted(id, Number(written['version']));
  const listed = await call(tools, 'space_list', {});
  assert.deepEqual(listed['spaces'], []);
  await assert.rejects(call(tools, 'space_read', { id }), /已删除/);
  await assert.rejects(call(tools, 'space_write', { id, version: 2, title: '签证核查', html: REPORT }), /最近删除/);
});
