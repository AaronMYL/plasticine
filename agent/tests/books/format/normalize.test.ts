import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstHeading, paragraphBlock, renderBlocks } from '../../../src/books/format/blocks.ts';
import { tokenize } from '../../../src/books/format/markup.ts';
import { normalizeMarkup } from '../../../src/books/format/normalize.ts';

/** Normalizes a fragment; images resolve when their src (or xlink:href) starts with "ok". */
function normalize(source: string): { html: string; text: string; keys: string[] } {
  const document = normalizeMarkup(tokenize(source), (attributes) => {
    const src = attributes.get('src') ?? attributes.get('xlink:href') ?? attributes.get('href') ?? '';
    return src.startsWith('ok') ? `k-${src.slice(2)}` : null;
  });
  return { ...renderBlocks(document.blocks), keys: document.imageKeys };
}

test('whitespace collapses runs to single space, trims block ends, converts NBSP, no gaps between', () => {
  const result = normalize('<body>\n  <p>  一\n\t二&nbsp;&nbsp;三  </p>\n\n  <p> <em> 强调 </em> 之后 </p>\n</body>');
  assert.equal(result.html, '<p>一 二 三</p><p><em>强调 </em>之后</p>');
  assert.equal(result.text, '一 二 三强调 之后');
});

test('strips leading full-width indent while preserving mid-paragraph full-width spaces', () => {
  assert.equal(normalize('<p>　　第一段　中间</p>').html, '<p>第一段　中间</p>');
});

test('maps h1->h2, h5/h6->h4, b->strong, i->em; keeps text only for unknown inline tags and links', () => {
  const html = normalize('<h1>大</h1><h5>小</h5><h6>更小</h6><p><b>粗</b><i>斜</i><span>普</span><a href="x">链</a></p>').html;
  assert.equal(html, '<h2>大</h2><h4>小</h4><h4>更小</h4><p><strong>粗</strong><em>斜</em>普链</p>');
});

test('flattens nested divs into sibling paragraphs with no nested blocks', () => {
  const html = normalize('<div>甲<div>乙<section>丙</section>丁</div>戊</div>').html;
  assert.equal(html, '<p>甲</p><p>乙</p><p>丙</p><p>丁</p><p>戊</p>');
});

test('inline formatting spanning multiple blocks closes cleanly inside each block', () => {
  assert.equal(normalize('<em>一<p>二</p>三</em>四').html, '<p><em>一</em></p><p><em>二</em></p><p><em>三</em>四</p>');
});

test('misnested inline tags are emitted with valid nesting', () => {
  assert.equal(normalize('<p><b>一<i>二</b>三</i></p>').html, '<p><strong>一<em>二</em></strong><em>三</em></p>');
});

test('table emits one paragraph per row joining non-empty cells with full-width spaces', () => {
  const source = '<table><tr><th>名</th><th>值</th></tr><tr><td> 甲 </td><td></td><td><p>1</p></td></tr></table>';
  const html = normalize(source).html;
  assert.equal(html.replaceAll('　', '_'), '<p>名_值</p><p>甲_1</p>');
});

test('table nested inside a cell merges into outer row without prematurely closing outer row', () => {
  const source = '<table><tr><td>外<table><tr><td>内一</td><td>内二</td></tr></table></td><td>尾</td></tr></table>后';
  assert.equal(normalize(source).html.replaceAll('　', '_'), '<p>外_内一_内二_尾</p><p>后</p>');
});

test('lists turn paragraphs inside li into items and flatten nested lists into outer list', () => {
  const html = normalize('<ol><li><p>一</p><p>二</p></li><li>三<ul><li>四</li></ul>五</li></ol>').html;
  assert.equal(html, '<ol><li>一</li><li>二</li><li>三</li><li>四</li><li>五</li></ol>');
});

test('blockquotes contain paragraphs, converting inner headings and list items to paragraphs', () => {
  const html = normalize('<blockquote>甲<h2>乙</h2><ul><li>丙</li></ul><blockquote>丁</blockquote></blockquote>').html;
  assert.equal(html, '<blockquote><p>甲</p><p>乙</p><p>丙</p><p>丁</p></blockquote>');
});

test('pre preserves whitespace, strips leading newline, normalizes CR to LF', () => {
  const result = normalize('<pre>\n  a  &lt;b&gt;\r\n\tc<br/>d\n</pre>');
  assert.equal(result.html, '<pre>  a  &lt;b&gt;\n\tc\nd</pre>');
  assert.equal(result.text, '  a  <b>\n\tc\nd');
});

test('br strips leading/trailing breaks, collapses consecutive breaks, trims adjacent spaces', () => {
  assert.equal(normalize('<p><br/>一 <br/><br/> 二<br/></p>').html, '<p>一<br>二</p>');
});

test('images resolve to data-asset or drop if unresolvable; image-only paragraphs are kept', () => {
  const result = normalize('<p><img src="ok1" alt="图 &quot;一&quot;"/>说明<img src="missing"/></p>'
    + '<div><img src="ok2"/></div>');
  assert.equal(result.html, '<p><img data-asset="k-1" alt="图 &quot;一&quot;">说明</p>'
    + '<p><img data-asset="k-2" alt=""></p>');
  assert.equal(result.text, '说明');
  assert.deepEqual(result.keys, ['k-1', 'k-2']);
});

test('SVG-wrapped cover image converts to img while dropping other SVG text', () => {
  const html = normalize('<svg><title>x</title><text>y</text><image xlink:href="ok9" width="1"/></svg>').html;
  assert.equal(html, '<p><img data-asset="k-9" alt=""></p>');
});

test('drops script, style, head, nav; recovers body when head closing tag is missing', () => {
  const source = '<html><head><title>T</title><body><nav><ol><li>目录</li></ol></nav><p>正文</p><script>x</script>';
  const html = normalize(source).html;
  assert.equal(html, '<p>正文</p>');
});

test('escapes only & < > ", preserves ruby and rt, drops rp', () => {
  const result = normalize('<p>a&amp;b &lt;c&gt; "d" \'e\' <ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby></p>');
  assert.equal(result.html, '<p>a&amp;b &lt;c&gt; &quot;d&quot; \'e\' <ruby>漢<rt>kan</rt></ruby></p>');
  assert.equal(result.text, 'a&b <c> "d" \'e\' 漢kan');
});

test('hr becomes standalone block, empty paragraphs drop, first heading provides chapter title', () => {
  const document = normalizeMarkup(tokenize('<p> </p><hr/><h3> 第 一 回 </h3><p>正文</p>'), () => null);
  assert.equal(renderBlocks(document.blocks).html, '<hr><h3>第 一 回</h3><p>正文</p>');
  assert.equal(firstHeading(document.blocks), '第 一 回');
});

test('plain text paragraphs undergo the same normalization', () => {
  assert.deepEqual(renderBlocks([paragraphBlock('　　 a\u0000  b ')]), { html: '<p>a b</p>', text: 'a b' });
});
