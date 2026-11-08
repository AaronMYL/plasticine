import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeed } from '../../src/daily/feed-parse.ts';

test('Atom XHTML 混合文字、嵌套元素、CDATA 和实体按文档顺序读取', () => {
  const at = '2026-10-28T08:00:00.000Z';
  for (const [body, expected] of [
    ['<p>先<b>备份</b>再切换</p>', '先备份再切换'],
    ['<p>先<b>备<i>份</i></b><![CDATA[再]]><em>核对</em>&amp;切换</p>', '先备份再核对&切换'],
    ['<p>先<b>备份</b>再切换</p><p>接着核对<br/>最后确认</p>', '先备份再切换 接着核对 最后确认'],
  ]) {
    const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry>'
      + '<title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">先<b>备份</b>再切换</div></title>'
      + `<link href="/story"/><updated>${at}</updated><content type="xhtml">`
      + `<div xmlns="http://www.w3.org/1999/xhtml">${body}</div></content></entry></feed>`;
    const item = parseFeed(atom, 'https://news.example.test/feed', new Date(at))[0];
    assert.equal(item?.title, '先备份再切换');
    assert.equal(item?.text, expected);
  }
});

for (const [name, body, expected] of [
  ['相邻表头和单元格', '<table><tr><th>甲</th><th>乙</th></tr><tr><td>丙</td><td>丁</td></tr></table>', '甲 乙 丙 丁'],
  ['定义列表', '<dl><dt>甲<b>项</b></dt><dd>解释甲</dd><dt>乙项</dt><dd>解释乙</dd></dl>', '甲项 解释甲 乙项 解释乙'],
  ['语义区块与水平线', '前文<section>第一节</section><article>正文</article><hr/><aside>附注</aside>后文',
    '前文 第一节 正文 附注 后文'],
  ['表格标题与分组', '前<table><caption>标题</caption><thead><tr><th>列</th></tr></thead>'
    + '<tbody><tr><td>值</td></tr></tbody><tfoot><tr><td>合计</td></tr></tfoot></table>后', '前 标题 列 值 合计 后'],
  ['带命名空间的单元格', '<x:table><x:tr><x:td>甲</x:td><x:td>乙</x:td></x:tr></x:table>', '甲 乙'],
]) {
  test(`Atom XHTML 的${name}保留文字边界，行内文字仍连续`, () => {
    const at = '2026-10-28T08:00:00.000Z';
    const atom = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:x="http://www.w3.org/1999/xhtml"><entry>'
      + `<title>订阅条目</title><link href="/story"/><updated>${at}</updated><content type="xhtml">`
      + `<div xmlns="http://www.w3.org/1999/xhtml">${body}</div></content></entry></feed>`;
    const item = parseFeed(atom, 'https://news.example.test/feed', new Date(at))[0];
    assert.equal(item?.text, expected);
  });
}
