import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstHeading, paragraphBlock, renderBlocks } from '../../src/books/blocks.ts';
import { tokenize } from '../../src/books/markup.ts';
import { normalizeMarkup } from '../../src/books/normalize.ts';

/** Normalizes a fragment; images resolve when their src (or xlink:href) starts with "ok". */
function normalize(source: string): { html: string; text: string; keys: string[] } {
  const document = normalizeMarkup(tokenize(source), (attributes) => {
    const src = attributes.get('src') ?? attributes.get('xlink:href') ?? attributes.get('href') ?? '';
    return src.startsWith('ok') ? `k-${src.slice(2)}` : null;
  });
  return { ...renderBlocks(document.blocks), keys: document.imageKeys };
}

test('空白：连续空白折成一个空格，块首尾去掉，NBSP 变普通空格，块之间没有空白', () => {
  const result = normalize('<body>\n  <p>  一\n\t二&nbsp;&nbsp;三  </p>\n\n  <p> <em> 强调 </em> 之后 </p>\n</body>');
  assert.equal(result.html, '<p>一 二 三</p><p><em>强调 </em>之后</p>');
  assert.equal(result.text, '一 二 三强调 之后');
});

test('段首的全角缩进去掉，段中的全角空格保留', () => {
  assert.equal(normalize('<p>　　第一段　中间</p>').html, '<p>第一段　中间</p>');
});

test('标签映射：h1→h2、h5/h6→h4、b→strong、i→em，未知行内标签只留文字，链接只留文字', () => {
  const html = normalize('<h1>大</h1><h5>小</h5><h6>更小</h6><p><b>粗</b><i>斜</i><span>普</span><a href="x">链</a></p>').html;
  assert.equal(html, '<h2>大</h2><h4>小</h4><h4>更小</h4><p><strong>粗</strong><em>斜</em>普链</p>');
});

test('div 套 div 拍平成并列的段落，块不嵌套', () => {
  const html = normalize('<div>甲<div>乙<section>丙</section>丁</div>戊</div>').html;
  assert.equal(html, '<p>甲</p><p>乙</p><p>丙</p><p>丁</p><p>戊</p>');
});

test('跨块的行内格式在每个块里各自闭合', () => {
  assert.equal(normalize('<em>一<p>二</p>三</em>四').html, '<p><em>一</em></p><p><em>二</em></p><p><em>三</em>四</p>');
});

test('错位嵌套的行内标签输出时仍然正确嵌套', () => {
  assert.equal(normalize('<p><b>一<i>二</b>三</i></p>').html, '<p><strong>一<em>二</em></strong><em>三</em></p>');
});

test('表格每行一段，单元格用全角空格连接，空单元格跳过', () => {
  const source = '<table><tr><th>名</th><th>值</th></tr><tr><td> 甲 </td><td></td><td><p>1</p></td></tr></table>';
  const html = normalize(source).html;
  assert.equal(html.replaceAll('　', '_'), '<p>名_值</p><p>甲_1</p>');
});

test('单元格里嵌套的表格并入外层这一行，不提前结束外层行', () => {
  const source = '<table><tr><td>外<table><tr><td>内一</td><td>内二</td></tr></table></td><td>尾</td></tr></table>后';
  assert.equal(normalize(source).html.replaceAll('　', '_'), '<p>外_内一_内二_尾</p><p>后</p>');
});

test('列表：li 里的段落各成一项，嵌套列表拍平进外层列表', () => {
  const html = normalize('<ol><li><p>一</p><p>二</p></li><li>三<ul><li>四</li></ul>五</li></ol>').html;
  assert.equal(html, '<ol><li>一</li><li>二</li><li>三</li><li>四</li><li>五</li></ol>');
});

test('引用里是段落，引用里的标题和列表项也变段落', () => {
  const html = normalize('<blockquote>甲<h2>乙</h2><ul><li>丙</li></ul><blockquote>丁</blockquote></blockquote>').html;
  assert.equal(html, '<blockquote><p>甲</p><p>乙</p><p>丙</p><p>丁</p></blockquote>');
});

test('pre 保留空白，首个换行去掉，CR 统一成 LF', () => {
  const result = normalize('<pre>\n  a  &lt;b&gt;\r\n\tc<br/>d\n</pre>');
  assert.equal(result.html, '<pre>  a  &lt;b&gt;\n\tc\nd</pre>');
  assert.equal(result.text, '  a  <b>\n\tc\nd');
});

test('br：块首块尾的去掉，连续的只留一个，前后空格去掉', () => {
  assert.equal(normalize('<p><br/>一 <br/><br/> 二<br/></p>').html, '<p>一<br>二</p>');
});

test('图片：能解析的变成 data-asset，解析不了的丢掉；只有图的段落保留', () => {
  const result = normalize('<p><img src="ok1" alt="图 &quot;一&quot;"/>说明<img src="missing"/></p>'
    + '<div><img src="ok2"/></div>');
  assert.equal(result.html, '<p><img data-asset="k-1" alt="图 &quot;一&quot;">说明</p>'
    + '<p><img data-asset="k-2" alt=""></p>');
  assert.equal(result.text, '说明');
  assert.deepEqual(result.keys, ['k-1', 'k-2']);
});

test('SVG 包着的封面图变成 img，SVG 里的其他文字不要', () => {
  const html = normalize('<svg><title>x</title><text>y</text><image xlink:href="ok9" width="1"/></svg>').html;
  assert.equal(html, '<p><img data-asset="k-9" alt=""></p>');
});

test('script、style、head、nav 丢掉，没有 head 结束标签时 body 恢复正文', () => {
  const source = '<html><head><title>T</title><body><nav><ol><li>目录</li></ol></nav><p>正文</p><script>x</script>';
  const html = normalize(source).html;
  assert.equal(html, '<p>正文</p>');
});

test('输出只转义 & < > "，ruby 和 rt 保留，rp 丢掉', () => {
  const result = normalize('<p>a&amp;b &lt;c&gt; "d" \'e\' <ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby></p>');
  assert.equal(result.html, '<p>a&amp;b &lt;c&gt; &quot;d&quot; \'e\' <ruby>漢<rt>kan</rt></ruby></p>');
  assert.equal(result.text, 'a&b <c> "d" \'e\' 漢kan');
});

test('hr 单独成块，空段落丢掉，第一个标题可取作章节名', () => {
  const document = normalizeMarkup(tokenize('<p> </p><hr/><h3> 第 一 回 </h3><p>正文</p>'), () => null);
  assert.equal(renderBlocks(document.blocks).html, '<hr><h3>第 一 回</h3><p>正文</p>');
  assert.equal(firstHeading(document.blocks), '第 一 回');
});

test('纯文字段落经过同样的清理', () => {
  assert.deepEqual(renderBlocks([paragraphBlock('　　 a\u0000  b ')]), { html: '<p>a b</p>', text: 'a b' });
});
