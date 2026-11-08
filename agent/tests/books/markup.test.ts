import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, tokenize } from '../../src/books/markup.ts';
import { attribute, findAll, findFirst, parseTree, textContent } from '../../src/books/tree.ts';

test('实体：数字、十六进制、常见命名实体都解码，不认识的原样保留', () => {
  assert.equal(decodeEntities('&#20013;&#x6587;&amp;&lt;&gt;&quot;&apos;'), '中文&<>"\'');
  assert.equal(decodeEntities('&nbsp;&mdash;&hellip;&ldquo;&rdquo;&copy;&eacute;'), ' —…“”©é');
  assert.equal(decodeEntities('&notanentity; &amp &#xZZ; a & b'), '&notanentity; &amp &#xZZ; a & b');
  assert.equal(decodeEntities('&#0;&#x110000;&#150;'), '��–');
});

test('标签、属性（单引号、双引号、无引号、无值）和自闭合都认得', () => {
  const tokens = tokenize('<P Class="a" id=\'b\' data-x=c hidden>Hi<br/></P>');
  assert.deepEqual(tokens[0], {
    kind: 'open',
    name: 'p',
    attributes: new Map([['class', 'a'], ['id', 'b'], ['data-x', 'c'], ['hidden', '']]),
    selfClosing: false,
  });
  assert.deepEqual(tokens.slice(1), [
    { kind: 'text', text: 'Hi' },
    { kind: 'open', name: 'br', attributes: new Map(), selfClosing: true },
    { kind: 'close', name: 'p' },
  ]);
});

test('注释、doctype、处理指令被跳过，CDATA 成为原样文字', () => {
  const tokens = tokenize('<?xml version="1.0"?><!DOCTYPE html><!-- <p>no</p> --><![CDATA[a &amp; <b>]]>');
  assert.deepEqual(tokens, [{ kind: 'text', text: 'a &amp; <b>' }]);
});

test('script 和 style 的内容不当标签解析', () => {
  const tokens = tokenize('<script>if (a < b) { x = "</p>"; }</script><p>ok</p>');
  assert.equal(tokens[1]?.kind, 'text');
  assert.deepEqual(tokens.at(-2), { kind: 'text', text: 'ok' });
});

test('残缺的标记不报错：孤立的 < 当文字，没结束的注释吞到结尾', () => {
  assert.deepEqual(tokenize('a < b <3'), [{ kind: 'text', text: 'a < b <3' }]);
  assert.deepEqual(tokenize('x<!-- never closed'), [{ kind: 'text', text: 'x' }]);
  assert.deepEqual(tokenize('<p class="open'), [{ kind: 'open', name: 'p', attributes: new Map([['class', 'open']]),
    selfClosing: false }]);
});

test('树：按本地名查找元素和属性，没关闭的元素也能取到文字', () => {
  const root = parseTree('<opf:package><dc:title> 书名 </dc:title><item opf:href="a.xhtml"/><p>未闭合');
  assert.equal(textContent(findFirst(root, 'title')), ' 书名 ');
  const item = findAll(root, 'item')[0];
  assert.ok(item !== undefined);
  assert.equal(attribute(item, 'href'), 'a.xhtml');
  assert.equal(textContent(findFirst(root, 'p')), '未闭合');
});
