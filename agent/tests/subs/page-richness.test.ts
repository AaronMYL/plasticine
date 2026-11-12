// 长报告只有段落的退回重排一次（11-12）：只看结构；短稿、够丰富的照收。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportTooPlain } from '../../src/subs/page-richness.ts';

const PARAGRAPH = `<p>${'这是一段很长的说明文字，没有任何结构。'.repeat(20)}</p>`;

test('几段话的短稿不查', () => {
  assert.equal(reportTooPlain('<h1>备忘</h1><p>明天下午三点开会，带上合同。</p>'), null);
});

test('长报告只有段落：退回，说清缺什么、怎么排', () => {
  const hint = reportTooPlain(`<h1>标题</h1>${PARAGRAPH.repeat(5)}`);
  assert.match(hint ?? '', /这一页还没存/);
  assert.match(hint ?? '', /rp-hero/);
  assert.match(hint ?? '', /现在用到的块：一个都没有/);
});

test('有页头、用了两种以上现成的块：照收；只有页头不够', () => {
  const hero = '<header class="rp-hero"><h1 class="rp-h1">结论</h1><div class="rp-stats"></div></header>';
  const rich = `${hero}<section class="rp-sec">${PARAGRAPH.repeat(4)}<div class="cards2">`
    + '<article class="rcard"></article></div><table class="rt"></table></section>';
  assert.equal(reportTooPlain(rich), null);
  const onlyHero = `<header class="rp-hero"><h1 class="rp-h1">结论</h1></header>${PARAGRAPH.repeat(5)}`;
  assert.match(reportTooPlain(onlyHero) ?? '', /现在用到的块：一个都没有/);
  assert.doesNotMatch(reportTooPlain(onlyHero) ?? '', /开头用 rp-hero/);
});

test('内联 svg 算图表；脚本和样式里的字不算正文', () => {
  const page = `<header class="rp-hero"></header><style>${'a{}'.repeat(2000)}</style>${PARAGRAPH.repeat(4)}`
    + '<svg viewBox="0 0 10 10"></svg><div class="lst"></div>';
  assert.equal(reportTooPlain(page), null);
});
