import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookParseError } from '../../src/books/index.ts';
import { readZip, ZIP_ENTRY_MAX_BYTES, ZIP_TOTAL_MAX_BYTES } from '../../src/books/zip.ts';
import { makeZip } from './fixtures.ts';

function code(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof BookParseError, String(error));
    return error.code;
  }
  return 'none';
}

test('读出存储和 deflate 两种条目，中文文件名按 UTF-8 解码', () => {
  const zip = readZip(makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'OEBPS/第一章.xhtml', data: '<p>中文</p>'.repeat(50) },
  ]));
  assert.deepEqual(zip.names(), ['mimetype', 'OEBPS/第一章.xhtml']);
  assert.equal(zip.read('mimetype')?.toString(), 'application/epub+zip');
  assert.equal(zip.read('OEBPS/第一章.xhtml')?.toString(), '<p>中文</p>'.repeat(50));
});

test('找不到的条目返回 null；大小写不同的路径也能找到', () => {
  const zip = readZip(makeZip([{ name: 'OEBPS/Text/A.xhtml', data: 'a' }]));
  assert.equal(zip.read('nope'), null);
  assert.equal(zip.read('oebps/text/a.xhtml')?.toString(), 'a');
});

test('不是 ZIP、被截断、中央目录损坏都算 corrupt', () => {
  const good = makeZip([{ name: 'a.txt', data: 'hello world' }]);
  assert.equal(code(() => readZip(Buffer.from('PK\u0003\u0004 not really a zip'))), 'corrupt');
  assert.equal(code(() => readZip(good.subarray(0, good.length - 30))), 'corrupt');
  const broken = Buffer.from(good);
  broken.writeUInt32LE(0x12345678, broken.length - 22 - 46 - 5);
  assert.equal(code(() => readZip(broken)), 'corrupt');
});

test('CRC 对不上的条目读取时报 corrupt', () => {
  const zip = readZip(makeZip([{ name: 'a.txt', data: 'hello', crc: 1 }]));
  assert.equal(code(() => zip.read('a.txt')), 'corrupt');
});

test('防 zip 炸弹：单个条目超过 100 MB 或总量超过 500 MB 拒绝；谎报大小的条目解压时拒绝', () => {
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
