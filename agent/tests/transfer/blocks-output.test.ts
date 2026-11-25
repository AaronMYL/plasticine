import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Block } from '../../src/artifacts/index.ts';
import { blocksMarkdown } from '../../src/transfer/blocks-markdown.ts';
import { reportFragment } from '../../src/transfer/report-fragment.ts';

const BLOCKS: Block[] = [
  { kind: 'heading', level: 1, inline: [{ text: '周报' }] },
  { kind: 'paragraph', inline: [{ text: '开头' }, { text: '一句', bold: true }] },
  { kind: 'heading', level: 2, inline: [{ text: '进展' }] },
  { kind: 'list', ordered: true, items: [[{ text: '先' }], [{ text: '后', italic: true }]] },
  { kind: 'table', head: [[{ text: '项' }], [{ text: '值' }]], rows: [[[{ text: 'a|b' }], [{ text: '1' }]]] },
  { kind: 'image', src: '/v2/notes/assets/a.png', alt: '示意' },
  { kind: 'heading', level: 2, inline: [{ text: '下一步' }] },
  { kind: 'quote', inline: [{ text: '原话' }] },
  { kind: 'code', text: 'a < b' },
  { kind: 'rule' },
  { kind: 'paragraph', inline: [{ text: '见' }, { text: '说明', link: 'https://x.test/?a=1&b=2' },
    { text: '`x`', code: true }] },
];

test('Renders blocks to Markdown with replaceable image URLs and escaped table pipes', () => {
  assert.equal(blocksMarkdown(BLOCKS, (src) => src.replace('/v2/notes/assets/', 'assets/')), [
    '# 周报', '开头**一句**', '## 进展', '1. 先\n2. *后*', '| 项 | 值 |\n| --- | --- |\n| a\\|b | 1 |',
    '![示意](assets/a.png)', '## 下一步', '> 原话', '```\na < b\n```', '---', '见[说明](https://x.test/?a=1&b=2)`` `x` ``',
  ].join('\n\n') + '\n');
});

test('Wraps blocks as base report: first H1 title, H2 sections, content under sections', () => {
  const html = reportFragment(BLOCKS, '备用标题');
  assert.equal(html, '<header class="rp-hero"><h1 class="rp-h1">周报</h1></header>'
    + '<section class="rp-sec" id="s1"><p>开头<strong>一句</strong></p></section>'
    + '<section class="rp-sec" id="s2"><h2>进展</h2><ol><li>先</li><li><em>后</em></li></ol>'
    + '<table class="rt"><thead><tr><th>项</th><th>值</th></tr></thead>'
    + '<tbody><tr><td>a|b</td><td>1</td></tr></tbody></table>'
    + '<figure class="img"><img src="/v2/notes/assets/a.png" alt="示意"><figcaption>示意</figcaption></figure></section>'
    + '<section class="rp-sec" id="s3"><h2>下一步</h2><blockquote><p>原话</p></blockquote><pre><code>a &lt; b</code></pre>'
    + '<hr><p>见<a href="https://x.test/?a=1&amp;b=2">说明</a><code>`x`</code></p></section>');
});

test('Falls back to given title without H1; renders external images as plain text line', () => {
  const html = reportFragment([{ kind: 'paragraph', inline: [{ text: '正文' }] },
    { kind: 'image', src: 'https://elsewhere.test/a.png', alt: '' }], '读书会');
  assert.equal(html, '<header class="rp-hero"><h1 class="rp-h1">读书会</h1></header>'
    + '<section class="rp-sec" id="s1"><p>正文</p><p class="f3">图片没带进来：https://elsewhere.test/a.png</p></section>');
});
