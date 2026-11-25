import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBook } from '../../../src/books/index.ts';
import { decodeText, TXT_PART_CHARS } from '../../../src/books/format/txt.ts';
import { assertWellFormed } from '../fixtures.ts';

test('TXT UTF-8 splits chapters into h2, puts preface in Opening, one paragraph per non-empty line', () => {
  const source = '作者的话\r\n\r\n　　这是序。\r\n第一章 开端\r\n　　第一段。\r\n\r\n第二段  有  空格。\r\n  第二章　发展  \n最后一段。\n';
  const book = parseBook({ fileName: '小说.txt', bytes: Buffer.from(source, 'utf8') });
  assertWellFormed(book);
  assert.equal(book.format, 'txt');
  assert.equal(book.title, '小说');
  assert.equal(book.author, null);
  assert.equal(book.cover, null);
  assert.deepEqual(book.images, []);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['开头', '第一章 开端', '第二章　发展']);
  assert.equal(book.chapters[0]?.html, '<p>作者的话</p><p>这是序。</p>');
  assert.equal(book.chapters[1]?.html, '<h2>第一章 开端</h2><p>第一段。</p><p>第二段 有 空格。</p>');
  assert.equal(book.chapters[2]?.text, '第二章　发展最后一段。');
});

test('TXT splits preface/prologue/extra/Chapter 3 headings while ignoring long body sentences', () => {
  const lines = [
    '楔子',
    '很久以前。',
    '第三回 风起',
    '第一次见面是在一个下雨的晚上，她撑着伞站在路口，看着来往的车辆，心里想着很多很多事情。',
    '番外一 后来',
    '后来的事。',
    'Chapter 3 The End',
    'Bye.',
  ];
  const book = parseBook({ fileName: 'a.txt', bytes: Buffer.from(lines.join('\n')) });
  assertWellFormed(book);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['楔子', '第三回 风起', '番外一 后来',
    'Chapter 3 The End']);
});

test('TXT without BOM and invalid UTF-8 decodes as GB18030', () => {
  const bytes = Buffer.concat([
    Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]),
    Buffer.from('\n'),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
  ]);
  assert.equal(decodeText(bytes), '第一章\n中文');
  const book = parseBook({ fileName: 'gbk.txt', bytes });
  assertWellFormed(book);
  assert.deepEqual(book.chapters.map((chapter) => [chapter.title, chapter.text]), [['第一章', '第一章中文']]);
});

test('TXT recognizes UTF-16LE, UTF-16BE, and UTF-8 BOMs', () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章\n正文', 'utf16le')]);
  assert.equal(decodeText(le), '第一章\n正文');
  const be = Buffer.from(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('中a', 'utf16le').swap16()]));
  assert.equal(decodeText(be), '中a');
  assert.equal(decodeText(Buffer.from('﻿abc', 'utf8')), 'abc');
  const book = parseBook({ fileName: 'u16.txt', bytes: le });
  assertWellFormed(book);
  assert.equal(book.chapters[0]?.text, '第一章正文');
});

test('TXT without headings splits at paragraph boundaries into ~8000-char parts', () => {
  const paragraph = '这是一段没有标题的文字。'.repeat(50);
  const bytes = Buffer.from(Array.from({ length: 40 }, () => paragraph).join('\n'));
  const book = parseBook({ fileName: 'plain.txt', bytes });
  assertWellFormed(book);
  assert.ok(book.chapters.length >= 3);
  book.chapters.forEach((chapter, index) => {
    assert.equal(chapter.title, `第 ${index + 1} 部分`);
    assert.ok(chapter.text.length <= TXT_PART_CHARS + paragraph.length);
  });
  assert.equal(book.chapters.map((chapter) => chapter.text).join(''), paragraph.repeat(40));
});

test('whitespace-only TXT reports empty', () => {
  assert.throws(() => parseBook({ fileName: 'blank.txt', bytes: Buffer.from(' \n\t\n　　\n') }), { code: 'empty' });
});
