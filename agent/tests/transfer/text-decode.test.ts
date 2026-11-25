import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeText } from '../../src/transfer/text-decode.ts';

test('Decodes UTF-8 (with/without BOM), UTF-16, and GBK normalizing newlines to \\n', () => {
  assert.equal(decodeText(Buffer.from('周末去西湖\r\n带相机', 'utf8')), '周末去西湖\n带相机');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('带 BOM', 'utf8')])), '带 BOM');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('小端', 'utf16le')])), '小端');
  assert.equal(decodeText(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), '你好');
});

test('Rejects non-text binary files', () => {
  assert.equal(decodeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])), null);
  assert.equal(decodeText(Buffer.from('有\u0000零字节', 'utf8')), null);
});
