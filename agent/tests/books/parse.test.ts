import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOK_MAX_BYTES, BookParseError, detectBookFormat, parseBook } from '../../src/books/index.ts';
import { CHAPTER_MAX_CHARS } from '../../src/books/parse.ts';
import { assertWellFormed, makeEpub, makeMobi, makeZip, xhtml } from './fixtures.ts';

function failure(work: () => unknown): BookParseError {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof BookParseError, String(error));
    return error;
  }
  assert.fail('应该报错');
}

const OPF = `<package version="3.0"><metadata><dc:title>长书</dc:title></metadata>
  <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="a"/></spine></package>`;

test('格式识别：先看字节，再看扩展名，都不认得时返回 null', () => {
  const epub = makeEpub({ 'OEBPS/content.opf': OPF });
  assert.equal(detectBookFormat('whatever.bin', epub), 'epub');
  assert.equal(detectBookFormat('book.epub', makeZip([{ name: 'a', data: 'b' }])), 'epub');
  assert.equal(detectBookFormat('x.zip', makeZip([{ name: 'a', data: 'b' }])), null);
  assert.equal(detectBookFormat('book.dat', makeMobi({ fullName: 'a', html: '<p>a</p>' })), 'mobi');
  assert.equal(detectBookFormat('book.dat', makeMobi({ fullName: 'a', html: '<p>a</p>', version: 8 })), 'azw3');
  assert.equal(detectBookFormat('book.AZW3', Buffer.from('not a pdb')), 'azw3');
  assert.equal(detectBookFormat('book.prc', Buffer.from('not a pdb')), 'mobi');
  assert.equal(detectBookFormat('notes.TXT', Buffer.from('hello')), 'txt');
  assert.equal(detectBookFormat('notes', Buffer.from([0xff, 0xfe, 0x41, 0x00])), 'txt');
  assert.equal(detectBookFormat('photo.jpg', Buffer.from([0xff, 0xd8, 0xff])), null);
});

test('不认得的格式报 unsupported，提示能导入哪些格式', () => {
  const error = failure(() => parseBook({ fileName: 'a.pdf', bytes: Buffer.from('%PDF-1.7') }));
  assert.equal(error.code, 'unsupported');
  assert.match(error.message, /EPUB、TXT、MOBI 或 AZW3/);
});

test('超过 100 MB 报 too_large，不再往下解析', () => {
  assert.equal(BOOK_MAX_BYTES, 100 * 1024 * 1024);
  const bytes = Buffer.alloc(BOOK_MAX_BYTES + 1);
  assert.equal(failure(() => parseBook({ fileName: 'big.txt', bytes })).code, 'too_large');
});

test('超过 6 万字的章节按块边界切开，后面的部分标题加（2）（3）', () => {
  const paragraph = '很长的一段话。'.repeat(1000);
  const body = `<h1>长章</h1>${Array.from({ length: 20 }, () => `<p>${paragraph}</p>`).join('')}`;
  const book = parseBook({ fileName: 'long.epub', bytes: makeEpub({ 'OEBPS/content.opf': OPF,
    'OEBPS/a.xhtml': xhtml(body) }) });
  assertWellFormed(book);
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['长章', '长章（2）', '长章（3）']);
  for (const chapter of book.chapters) {
    assert.ok(chapter.text.length <= CHAPTER_MAX_CHARS);
    assert.ok(chapter.html.startsWith('<p>') || chapter.html.startsWith('<h2>'));
  }
  assert.equal(book.chapters.map((chapter) => chapter.text).join(''), `长章${paragraph.repeat(20)}`);
});

test('解析器内部的意外错误统一包成 corrupt，原因放在 cause 里', () => {
  const bytes = makeMobi({ fullName: 'a', html: '<p>a</p>' });
  // A MOBI header length far past the record makes the EXTH read run off the end of the buffer.
  bytes.writeUInt32BE(0x7fff0000, bytes.readUInt32BE(78) + 20);
  const error = failure(() => parseBook({ fileName: 'a.mobi', bytes }));
  assert.equal(error.code, 'corrupt');
  assert.match(error.message, /已损坏/);
});
