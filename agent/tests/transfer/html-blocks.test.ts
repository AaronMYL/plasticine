import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlBlocks } from '../../src/transfer/html-blocks.ts';

test('标题、段落、列表、表格、引用、代码、图、分隔线都认得；行内的粗体、斜体、代码、链接留着', () => {
  const html = '<header class="rp-hero"><h1 class="rp-h1">周报</h1></header><section class="rp-sec">'
    + '<h2>进展</h2><p>这周<strong>上线</strong>了 <em>两个</em> <code>新功能</code>，见<a href="https://x.test/a">说明</a>。</p>'
    + '<ul><li>一</li><li>二</li></ul><ol><li>先</li></ol>'
    + '<table class="rt"><thead><tr><th>项</th><th>值</th></tr></thead>'
    + '<tbody><tr><td>甲</td><td>1</td></tr></tbody></table>'
    + '<blockquote><p>原话</p></blockquote><pre>a &lt; b</pre><figure class="img"><img src="/v2/notes/assets/a.png"'
    + ' alt="示意"><figcaption>图注</figcaption></figure><hr><h4>小节</h4></section>';
  assert.deepEqual(htmlBlocks(html), [
    { kind: 'heading', level: 1, inline: [{ text: '周报' }] },
    { kind: 'heading', level: 2, inline: [{ text: '进展' }] },
    { kind: 'paragraph', inline: [{ text: '这周' }, { text: '上线', bold: true }, { text: '了 ' },
      { text: '两个', italic: true }, { text: ' ' }, { text: '新功能', code: true }, { text: '，见' },
      { text: '说明', link: 'https://x.test/a' }, { text: '。' }] },
    { kind: 'list', ordered: false, items: [[{ text: '一' }], [{ text: '二' }]] },
    { kind: 'list', ordered: true, items: [[{ text: '先' }]] },
    { kind: 'table', head: [[{ text: '项' }], [{ text: '值' }]], rows: [[[{ text: '甲' }], [{ text: '1' }]]] },
    { kind: 'quote', inline: [{ text: '原话' }] },
    { kind: 'code', text: 'a < b' },
    { kind: 'image', src: '/v2/notes/assets/a.png', alt: '图注' },
    { kind: 'rule' },
    { kind: 'heading', level: 3, inline: [{ text: '小节' }] },
  ]);
});

test('版式里的块（数字条、卡片）摊成段落，脚本、样式、图表的 svg 和目录不要；空白收成一个', () => {
  const html = '<style>.x{}</style><script>run()</script><nav class="rp-nav"><a href="#a">甲</a></nav>'
    + '<div class="rp-stats"><div class="rp-stat"><div class="v"><b>12</b><i>篇</i></div><div class="l">新笔记</div>'
    + '</div></div><div class="cards2"><div class="rcard"><h3>结论</h3>  多一点\n  少一点 </div></div>'
    + '<svg viewBox="0 0 1 1"><text>图里的字</text></svg>';
  assert.deepEqual(htmlBlocks(html), [
    { kind: 'paragraph', inline: [{ text: '12', bold: true }, { text: '篇', italic: true }] },
    { kind: 'paragraph', inline: [{ text: '新笔记' }] },
    { kind: 'heading', level: 3, inline: [{ text: '结论' }] },
    { kind: 'paragraph', inline: [{ text: '多一点 少一点' }] },
  ]);
});

test('整个网页文件只读 body；没有 body 的当片段', () => {
  const page = '<!doctype html><html><head><title>标题</title><style>p{}</style></head>'
    + '<body><p>正文</p></body></html>';
  assert.deepEqual(htmlBlocks(page), [{ kind: 'paragraph', inline: [{ text: '正文' }] }]);
});
