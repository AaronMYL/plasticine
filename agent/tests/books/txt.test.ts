import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBook } from '../../src/books/index.ts';
import { decodeText, TXT_PART_CHARS } from '../../src/books/txt.ts';
import { assertWellFormed } from './fixtures.ts';

test('TXT：UTF-8，第一章 / 第二章切章，标题成 h2，章节前的文字成「开头」，每个非空行一段', () => {
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

test('TXT：序言、楔子、番外、Chapter 3 这类标题也切章；正文里以「第」开头的长句不算标题', () => {
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

test('TXT：没有 BOM 又不是合法 UTF-8 时按 GB18030 解码', () => {
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

test('TXT：UTF-16LE、UTF-16BE 和 UTF-8 的 BOM 都认得', () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章\n正文', 'utf16le')]);
  assert.equal(decodeText(le), '第一章\n正文');
  const be = Buffer.from(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('中a', 'utf16le').swap16()]));
  assert.equal(decodeText(be), '中a');
  assert.equal(decodeText(Buffer.from('﻿abc', 'utf8')), 'abc');
  const book = parseBook({ fileName: 'u16.txt', bytes: le });
  assertWellFormed(book);
  assert.equal(book.chapters[0]?.text, '第一章正文');
});

test('TXT：没有任何标题时按段落边界切成约 8000 字一部分', () => {
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

test('TXT：只有空白时报 empty', () => {
  assert.throws(() => parseBook({ fileName: 'blank.txt', bytes: Buffer.from(' \n\t\n　　\n') }), { code: 'empty' });
});
