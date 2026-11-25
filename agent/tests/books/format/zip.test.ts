import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookParseError } from '../../../src/books/index.ts';
import { readZip, ZIP_ENTRY_MAX_BYTES, ZIP_TOTAL_MAX_BYTES } from '../../../src/books/format/zip.ts';
import { makeZip } from '../fixtures.ts';

function code(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof BookParseError, String(error));
    return error.code;
  }
  return 'none';
}

test('ZIP reads stored and deflate entries and decodes UTF-8 CJK filenames', () => {
  const zip = readZip(makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'OEBPS/第一章.xhtml', data: '<p>中文</p>'.repeat(50) },
  ]));
  assert.deepEqual(zip.names(), ['mimetype', 'OEBPS/第一章.xhtml']);
  assert.equal(zip.read('mimetype')?.toString(), 'application/epub+zip');
  assert.equal(zip.read('OEBPS/第一章.xhtml')?.toString(), '<p>中文</p>'.repeat(50));
});

test('ZIP returns null for missing entry and matches paths case-insensitively', () => {
  const zip = readZip(makeZip([{ name: 'OEBPS/Text/A.xhtml', data: 'a' }]));
  assert.equal(zip.read('nope'), null);
  assert.equal(zip.read('oebps/text/a.xhtml')?.toString(), 'a');
});

test('non-ZIP, truncated file, and corrupt central directory report corrupt', () => {
  const good = makeZip([{ name: 'a.txt', data: 'hello world' }]);
  assert.equal(code(() => readZip(Buffer.from('PK\u0003\u0004 not really a zip'))), 'corrupt');
  assert.equal(code(() => readZip(good.subarray(0, good.length - 30))), 'corrupt');
  const broken = Buffer.from(good);
  broken.writeUInt32LE(0x12345678, broken.length - 22 - 46 - 5);
  assert.equal(code(() => readZip(broken)), 'corrupt');
});

test('ZIP entry with CRC mismatch reports corrupt on read', () => {
  const zip = readZip(makeZip([{ name: 'a.txt', data: 'hello', crc: 1 }]));
  assert.equal(code(() => zip.read('a.txt')), 'corrupt');
});

test('zip bomb guard rejects entry >100 MB, total >500 MB, or forged uncompressed size', () => {
  assert.equal(ZIP_ENTRY_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(ZIP_TOTAL_MAX_BYTES, 500 * 1024 * 1024);
  const huge = makeZip([{ name: 'a', data: 'x', declaredSize: ZIP_ENTRY_MAX_BYTES + 1 }]);
  assert.equal(code(() => readZip(huge)), 'too_large');
  const many = makeZip(Array.from({ length: 6 }, (_, index) => ({
    name: `part-${index}`,
    data: 'x',
    declaredSize: ZIP_ENTRY_MAX_BYTES - 1,
  })));
  assert.equal(code(() => readZip(many)), 'too_large');
  const liar = readZip(makeZip([{ name: 'bomb', data: Buffer.alloc(200_000), declaredSize: 10 }]));
  assert.equal(code(() => liar.read('bomb')), 'corrupt');
});
