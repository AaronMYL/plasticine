// 旧空间按新版式重写（第 8 批第 6 条）：服务起来以后的一次性后台活。个人回顾写成来信、别的写成报告；做成了记下、
// 重启不再做；没做成留着旧版、下次启动再试，试满次数就停；数字对不上算没做成；重写前的版本留在历史里。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { SpaceDoc } from '../../shared/state.ts';
import type { TextModels, TextRequest } from '../../src/kernel/index.ts';
import { ensureReviewSubscription, REVIEW_SUBSCRIPTION_ID, REWRITE_ATTEMPTS_MAX, SpaceRewriter }
  from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const REPORT_DOC: SpaceDoc = { kicker: '本次 7 条信息流', headline: '最值得细读的是记忆研究原文',
  stats: [{ value: '7', label: '条信息流已整理' }, { value: '3', label: '条追到原文' }],
  blocks: [{ type: 'heading', id: 'scope', text: '先说核实范围' }, { type: 'text', markdown: '只读了原文。' },
    { type: 'chart', kind: 'bar', title: '准确率', x: ['单独搜索', '搜索加 Wiki'], series: [{ name: '准确率',
      values: [53, 61.5] }], unit: '%', caption: '方法 → 准确率', source: { label: 'Anthropic 原文' } }],
  sources: [] };
const LETTER_DOC: SpaceDoc = { headline: '认知科学周报已有图文样刊', stats: [{ value: '1 期', label: '研究样刊' }],
  blocks: [{ type: 'heading', id: 'talk', text: '来自交流' }, { type: 'text', markdown: '样刊写好了。' }], sources: [] };

const REPORT_HTML = '<header class="rp-hero"><p class="rp-kick">本次 7 条信息流</p><h1 class="rp-h1">最值得细读的是记忆研究原文'
  + '</h1><div class="rp-stats"><div class="rp-stat"><div class="v"><b>7</b></div><div class="l">条信息流已整理</div></div>'
  + '<div class="rp-stat"><div class="v"><b>3</b></div><div class="l">条追到原文</div></div></div></header>'
  + '<section class="rp-sec" id="scope"><h2>先说核实范围</h2><p>只读了原文。</p><figure class="ch"><div class="brow">'
  + '<span class="bl">单独搜索</span><span class="track"><i class="b" style="width:53%"></i></span>'
  + '<span class="bv">53%</span>'
  + '</div><div class="brow"><span class="bl">搜索加 Wiki</span><span class="track"><i class="b" style="width:61.5%"></i>'
  + '</span><span class="bv">61.5%</span></div></figure></section>';
const LETTER_HTML = '<p class="lt-lead">认知科学周报已有图文样刊，1 期研究样刊写好了。</p>'
  + '<figure class="lt-fig" data-illustrate="一本摊开的期刊"><figcaption>样刊。</figcaption></figure><p>下一步看看要不要开定时。</p>';

function seed(): { report: string; letter: string } {
  ensureReviewSubscription(t.state, 'Asia/Shanghai');
  const report = t.state.spaces.create({ title: 'AI 信息流核查', doc: REPORT_DOC, author: 'ai' });
  const letter = t.state.spaces.create({ title: '个人日报｜从关注研究，到检验自己的解释', doc: LETTER_DOC, author: 'ai',
    subscriptionId: REVIEW_SUBSCRIPTION_ID, issueNumber: 2, edition: 'daily' });
  return { report: report.id, letter: letter.id };
}

function fakeText(answer: (request: TextRequest) => string): { text: TextModels; asked: TextRequest[] } {
  const asked: TextRequest[] = [];
  return { asked, text: { ask: async (request) => {
    asked.push(request);
    return { text: answer(request), complete: true };
  } } };
}

const byGenre = (request: TextRequest): string => (request.purpose === 'review'
  ? `\`\`\`html\n<h1>个人日报</h1>${LETTER_HTML}\n\`\`\`` : REPORT_HTML);

test('个人回顾的各期重写成来信、别的重写成报告；内容数字不变；重写前的版本留在历史；重启不再做', async () => {
  const ids = seed();
  const { text, asked } = fakeText(byGenre);
  const drawn: string[] = [];
  const rewriter = new SpaceRewriter({ state: t.state, text, saveAsset: () => 'art.webp',
    illustrator: { draw: async (prompt) => {
      drawn.push(prompt);
      return { data: Buffer.from('x'), mime: 'image/webp' };
    } } });
  const result = await rewriter.once();
  assert.deepEqual(result?.done.sort(), [ids.report, ids.letter].sort());
  assert.deepEqual(asked.map((request) => request.purpose).sort(), ['researcher', 'review']);
  assert.match(asked[0]?.system ?? '', /内容和数字一个都不改/);
  const report = t.state.spaces.require(ids.report);
  assert.equal(report.genre, 'report');
  assert.equal(report.html, REPORT_HTML);
  const letter = t.state.spaces.require(ids.letter);
  assert.equal(letter.genre, 'letter');
  assert.match(letter.html ?? '', /<img src="\/v2\/notes\/assets\/art\.webp"/);
  assert.doesNotMatch(letter.html ?? '', /<h1/);
  assert.deepEqual(drawn, ['一本摊开的期刊']);
  const history = t.state.spaces.revision(ids.report, 1);
  assert.deepEqual([history?.html, history?.doc.headline], [null, '最值得细读的是记忆研究原文']);
  assert.equal(t.state.spaces.revision(ids.report, 2)?.change, '按新版式重写');
  assert.equal(rewriter.once(), null);
  const again = fakeText(byGenre);
  const restarted = await new SpaceRewriter({ state: t.state, text: again.text, illustrator: null,
    saveAsset: () => 'x' }).once();
  assert.deepEqual(restarted, { done: [], failed: [] });
  assert.equal(again.asked.length, 0);
});

test('没做成留着旧版、下次启动再试；数字对不上也算没做成；试满次数就不再试', async () => {
  const ids = seed();
  t.state.spaces.markDeleted(ids.letter, 1);
  const broken = fakeText(() => REPORT_HTML.replaceAll('61.5%', '62%'));
  const first = await new SpaceRewriter({ state: t.state, text: broken.text, illustrator: null, saveAsset: () => 'x' })
    .once();
  assert.deepEqual(first?.failed.map((item) => item.reason), ['重写后少了旧版里的数：61.5']);
  assert.equal(t.state.spaces.require(ids.report).html, null);
  assert.equal(t.state.spaceRewrites.get(ids.report)?.attempts, 1);
  const down: TextModels = { ask: async () => {
    throw new Error('连不上模型');
  } };
  for (let attempt = 2; attempt <= REWRITE_ATTEMPTS_MAX; attempt += 1) {
    await new SpaceRewriter({ state: t.state, text: down, illustrator: null, saveAsset: () => 'x' }).once();
  }
  assert.deepEqual([t.state.spaceRewrites.get(ids.report)?.attempts, t.state.spaceRewrites.get(ids.report)?.lastError],
    [REWRITE_ATTEMPTS_MAX, '连不上模型']);
  const late = fakeText(byGenre);
  const stopped = await new SpaceRewriter({ state: t.state, text: late.text, illustrator: null, saveAsset: () => 'x' })
    .once();
  assert.deepEqual(stopped, { done: [], failed: [] });
  assert.equal(late.asked.length, 0);
});
