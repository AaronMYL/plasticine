import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookParseError, parseBook } from '../../src/books/index.ts';
import { decompressPalmDoc, trailingEntriesSize } from '../../src/books/palmdoc.ts';
import {
  assertWellFormed,
  EOF_RECORD,
  fakeJpeg,
  fakePng,
  fdstRecord,
  makeMobi,
  makePdb,
  mobiHeaderRecord,
  palmdocCompress,
  textRecords,
} from './fixtures.ts';

function failure(work: () => unknown): BookParseError {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof BookParseError, String(error));
    return error;
  }
  assert.fail('应该报错');
}

test('PalmDOC：手写的字面量、转义串、空格合并和回引都解对', () => {
  const data = Buffer.from([0x61, 0x62, 0x63, 0x80, 0x18, 0xc1, 0x02, 0xe4, 0xb8, 0x00]);
  assert.deepEqual(decompressPalmDoc(data), Buffer.from([...Buffer.from('abcabc A'), 0xe4, 0xb8, 0x00]));
});

test('PalmDOC：压缩再解压还原中文、空格和重复文字', () => {
  const text = Buffer.from('　　中文段落 And spaces ABAB '.repeat(200) + '\u0001\u0008 end', 'utf8');
  const compressed = palmdocCompress(text);
  assert.ok(compressed.length < text.length);
  assert.deepEqual(decompressPalmDoc(compressed), text);
});

test('PalmDOC：回引超出已解出的内容时报 corrupt', () => {
  assert.equal(failure(() => decompressPalmDoc(Buffer.from([0x80, 0x18]))).code, 'corrupt');
});

test('尾部条目：按 extra-data 标志去掉 TBS 和多字节条目', () => {
  const record = Buffer.from([0x41, 0x42, 0xaa, 0xbb, 0x02, 0x00, 0x82]);
  assert.equal(trailingEntriesSize(record, 0b11), 5);
  assert.equal(trailingEntriesSize(record, 0b10), 2);
  assert.equal(trailingEntriesSize(record, 0), 0);
});

const COVER = fakeJpeg('mobi-cover');
const FIGURE = fakePng('mobi-figure');
const LONG = '长段落的文字，重复很多次以便跨越多个记录。'.repeat(300);

function mobi6(overrides: Partial<Parameters<typeof makeMobi>[0]> = {}): Buffer {
  return makeMobi({
    fullName: 'Full Name',
    html: `<html><head><guide><reference type="toc" title="目录" filepos=0000000123 /></guide></head><body>
      <h2>第一章</h2><p>正文一，含 &amp; 实体。</p><p><img recindex="00002" /></p><mbp:pagebreak/>
      <h2>第二章</h2><p>${LONG}</p><mbp:pagebreak /></body></html>`,
    exth: [[100, '作者甲'], [503, '更新的书名'], [524, 'zh'], [201, 0]],
    images: [COVER, FIGURE],
    extraFlags: 0b11,
    ...overrides,
  });
}

test('MOBI6：PalmDOC 压缩、分页符切章、EXTH 书名作者、recindex 插图和封面', () => {
  const book = parseBook({ fileName: 'book.mobi', bytes: mobi6() });
  assertWellFormed(book);
  assert.equal(book.format, 'mobi');
  assert.equal(book.title, '更新的书名');
  assert.equal(book.author, '作者甲');
  assert.equal(book.language, 'zh');
  assert.deepEqual(book.cover?.bytes, COVER);
  assert.equal(book.cover?.mime, 'image/jpeg');
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['第一章', '第二章']);
  const figure = book.images.find((image) => image.bytes.equals(FIGURE));
  assert.ok(figure !== undefined);
  const image = `<img data-asset="${figure.key}" alt="">`;
  assert.equal(book.chapters[0]?.html, `<h2>第一章</h2><p>正文一，含 &amp; 实体。</p><p>${image}</p>`);
  assert.equal(book.chapters[1]?.text, `第二章${LONG}`);
});

test('MOBI：没有 EXTH 503 时用 full name，不压缩的文本也能读', () => {
  const book = parseBook({ fileName: 'x.mobi', bytes: mobi6({ exth: [], compression: 1, extraFlags: 0 }) });
  assertWellFormed(book);
  assert.equal(book.title, 'Full Name');
  assert.equal(book.author, null);
  assert.equal(book.cover, null);
});

test('MOBI：加密字段不为 0 时报 drm', () => {
  assert.equal(failure(() => parseBook({ fileName: 'x.azw', bytes: mobi6({ encryption: 2 }) })).code, 'drm');
});

test('MOBI：HUFF/CDIC 压缩报 unsupported，并建议用 Calibre 转 EPUB', () => {
  const error = failure(() => parseBook({ fileName: 'x.mobi', bytes: mobi6({ compression: 17480 }) }));
  assert.equal(error.code, 'unsupported');
  assert.match(error.message, /Calibre.*EPUB/);
});

test('MOBI：记录表越界或文件被截断时报 corrupt', () => {
  const bytes = mobi6();
  assert.equal(failure(() => parseBook({ fileName: 'x.mobi', bytes: bytes.subarray(0, 120) })).code, 'corrupt');
  const broken = Buffer.from(bytes);
  broken.writeUInt32BE(0xfffffff0, 78 + 8);
  assert.equal(failure(() => parseBook({ fileName: 'x.mobi', bytes: broken })).code, 'corrupt');
});

const KF8_HTML = '<?xml version="1.0"?><html><head><title>t</title>'
  + '<link href="kindle:flow:0001?mime=text/css" /></head><body><div aid="0"></div></body></html>'
  + '<p>第一节文字</p><p><img src="kindle:embed:0001?mime=image/jpeg" alt="封"/></p>'
  + '<?xml version="1.0"?><html><head><title>t</title></head><body><div aid="1"></div></body></html>'
  + '<h3>第二节</h3><p>文字二</p>';

test('AZW3（独立 KF8）：按 FDST 只取正文流，按文件切章，kindle:embed 插图和封面', () => {
  const bytes = makeMobi({
    fullName: 'KF8 Book',
    html: KF8_HTML,
    css: 'p { color: red } .secret-css-text {}',
    version: 8,
    images: [COVER],
    exth: [[100, '乙'], [201, 0]],
    extraFlags: 0b10,
  });
  const book = parseBook({ fileName: 'kf8.azw3', bytes });
  assertWellFormed(book);
  assert.equal(book.format, 'azw3');
  assert.equal(book.title, 'KF8 Book');
  assert.deepEqual(book.chapters.map((chapter) => chapter.title), ['第 1 章', '第二节']);
  assert.equal(book.chapters[0]?.html, `<p>第一节文字</p><p><img data-asset="${book.cover?.key}" alt="封"></p>`);
  assert.ok(book.chapters.every((chapter) => !chapter.text.includes('secret-css')));
});

test('MOBI6 + KF8 合订文件：按 EXTH 121 找到 KF8 部分并用它的正文，格式记作 azw3', () => {
  const oldHtml = Buffer.from('<html><body><p>旧版正文</p></body></html>');
  const newHtml = Buffer.from('<html><body><p>新版正文</p><img src="kindle:embed:0001"/></body></html>');
  const oldTexts = textRecords(oldHtml, 2, 0);
  const newTexts = textRecords(newHtml, 2, 0);
  const imageIndex = oldTexts.length + 1;
  const kf8Index = imageIndex + 2;
  const header6 = mobiHeaderRecord({
    compression: 2,
    textLength: oldHtml.length,
    textRecordCount: oldTexts.length,
    version: 6,
    fullName: '合订',
    firstImageIndex: imageIndex,
    exth: [[121, kf8Index], [201, 0]],
  });
  const header8 = mobiHeaderRecord({
    compression: 2,
    textLength: newHtml.length,
    textRecordCount: newTexts.length,
    version: 8,
    fullName: '合订',
    firstImageIndex: 0xffffffff,
    exth: [[201, 0]],
    fdstIndex: newTexts.length + 1,
  });
  const bytes = makePdb('joint', [
    header6,
    ...oldTexts,
    COVER,
    Buffer.from('BOUNDARY'),
    header8,
    ...newTexts,
    fdstRecord([[0, newHtml.length]]),
    EOF_RECORD,
  ]);
  const book = parseBook({ fileName: 'joint.mobi', bytes });
  assertWellFormed(book);
  assert.equal(book.format, 'azw3');
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0]?.text, '新版正文');
  assert.deepEqual(book.cover?.bytes, COVER);
  assert.equal(book.images.length, 1);
});
