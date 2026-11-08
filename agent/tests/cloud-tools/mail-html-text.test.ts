import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanMailText, decodeEntities, htmlToText } from '../../src/cloud-tools/mail-html-text.ts';

test('实体：十进制、十六进制、常见命名实体都还原，不认得的原样留着', () => {
  assert.equal(decodeEntities('&#20320;&#x597D;&#X4E16;&quot;&amp;&lt;&gt;&apos;&copy;&reg;&trade;&mdash;&euro;'),
    '你好世"&<>\'©®™—€');
  assert.equal(decodeEntities('&nosuch; &amp &#xZZ; &#1114112;'), '&nosuch; &amp &#xZZ; &#1114112;');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
});

test('段落、换行、列表、表格各占自己的行，整封不压成一行', () => {
  const html = '<div><h1>标题</h1><p>第一段<br>第二行</p><ul><li>一</li><li>二</li></ul>'
    + '<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td></tr></table><p>结尾</p></div>';
  assert.equal(htmlToText(html), '标题\n\n第一段\n第二行\n\n一\n二\n\n甲 乙\n丙\n\n结尾');
});

test('样式、脚本、头部和注释里的东西不进文字', () => {
  const html = '<html><head><title>T</title><style>.x{color:red}</style></head><body><!-- 注释 -->'
    + '<script>alert(1)</script><p>正文</p></body></html>';
  assert.equal(htmlToText(html), '正文');
});

test('营销信的零宽字符和软连字符都去掉，行尾空白收掉', () => {
  const text = 'Hi​‌‍⁠﻿­͏ there   \n\n\n\nnext line';
  assert.equal(cleanMailText(text), 'Hi there\n\nnext line');
  assert.equal(htmlToText('<p>&zwnj;&nbsp;&zwnj;&nbsp;</p><p>内容</p>'), '内容');
});
