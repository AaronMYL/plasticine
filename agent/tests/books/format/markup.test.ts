import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, tokenize } from '../../../src/books/format/markup.ts';
import { attribute, findAll, findFirst, parseTree, textContent } from '../../../src/books/format/tree.ts';

test('HTML entities decode decimal, hex, and common named entities while keeping unknown verbatim', () => {
  assert.equal(decodeEntities('&#20013;&#x6587;&amp;&lt;&gt;&quot;&apos;'), '中文&<>"\'');
  assert.equal(decodeEntities('&nbsp;&mdash;&hellip;&ldquo;&rdquo;&copy;&eacute;'), ' —…“”©é');
  assert.equal(decodeEntities('&notanentity; &amp &#xZZ; a & b'), '&notanentity; &amp &#xZZ; a & b');
  assert.equal(decodeEntities('&#0;&#x110000;&#150;'), '��–');
});

test('HTML parser recognizes tags, single/double/unquoted/valueless attributes, and self-closing', () => {
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

test('HTML parser skips comments, doctype, and PIs while converting CDATA to raw text', () => {
  const tokens = tokenize('<?xml version="1.0"?><!DOCTYPE html><!-- <p>no</p> --><![CDATA[a &amp; <b>]]>');
  assert.deepEqual(tokens, [{ kind: 'text', text: 'a &amp; <b>' }]);
});

test('HTML parser does not parse script and style contents as tags', () => {
  const tokens = tokenize('<script>if (a < b) { x = "</p>"; }</script><p>ok</p>');
  assert.equal(tokens[1]?.kind, 'text');
  assert.deepEqual(tokens.at(-2), { kind: 'text', text: 'ok' });
});

test('malformed markup does not throw: stray < becomes text, unclosed comment runs to EOF', () => {
  assert.deepEqual(tokenize('a < b <3'), [{ kind: 'text', text: 'a < b <3' }]);
  assert.deepEqual(tokenize('x<!-- never closed'), [{ kind: 'text', text: 'x' }]);
  assert.deepEqual(tokenize('<p class="open'), [{ kind: 'open', name: 'p', attributes: new Map([['class', 'open']]),
    selfClosing: false }]);
});

test('DOM tree finds elements/attrs by local name and extracts text from unclosed elements', () => {
  const root = parseTree('<opf:package><dc:title> 书名 </dc:title><item opf:href="a.xhtml"/><p>未闭合');
  assert.equal(textContent(findFirst(root, 'title')), ' 书名 ');
  const item = findAll(root, 'item')[0];
  assert.ok(item !== undefined);
  assert.equal(attribute(item, 'href'), 'a.xhtml');
  assert.equal(textContent(findFirst(root, 'p')), '未闭合');
});
