import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanMailText, decodeEntities, htmlToText } from '../../src/cloud-tools/mail-html-text.ts';

test('decodes decimal, hex, and named HTML entities while preserving unknown entities verbatim', () => {
  assert.equal(decodeEntities('&#20320;&#x597D;&#X4E16;&quot;&amp;&lt;&gt;&apos;&copy;&reg;&trade;&mdash;&euro;'),
    '你好世"&<>\'©®™—€');
  assert.equal(decodeEntities('&nosuch; &amp &#xZZ; &#1114112;'), '&nosuch; &amp &#xZZ; &#1114112;');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
});

test('paragraphs, breaks, lists, and tables occupy own lines instead of collapsing whole mail', () => {
  const html = '<div><h1>标题</h1><p>第一段<br>第二行</p><ul><li>一</li><li>二</li></ul>'
    + '<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td></tr></table><p>结尾</p></div>';
  assert.equal(htmlToText(html), '标题\n\n第一段\n第二行\n\n一\n二\n\n甲 乙\n丙\n\n结尾');
});

test('strips style, script, head, and comment contents from extracted email text', () => {
  const html = '<html><head><title>T</title><style>.x{color:red}</style></head><body><!-- 注释 -->'
    + '<script>alert(1)</script><p>正文</p></body></html>';
  assert.equal(htmlToText(html), '正文');
});

test('strips marketing zero-width chars and soft hyphens and trims trailing line whitespace', () => {
  const text = 'Hi​‌‍⁠﻿­͏ there   \n\n\n\nnext line';
  assert.equal(cleanMailText(text), 'Hi there\n\nnext line');
  assert.equal(htmlToText('<p>&zwnj;&nbsp;&zwnj;&nbsp;</p><p>内容</p>'), '内容');
});
