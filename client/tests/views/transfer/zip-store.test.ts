import { expect, it } from 'vitest';
import { crc32, zipStore } from '../../../src/views/transfer/zip-store.ts';

function readBack(data: Buffer): Record<string, string> {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const nameLength = data.readUInt16LE(at + 28);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    const size = data.readUInt32LE(at + 20);
    const local = data.readUInt32LE(at + 42);
    const start = local + 30 + data.readUInt16LE(local + 26);
    out[name] = data.toString('utf8', start, start + size);
    expect(crc32(data.subarray(start, start + size))).toBe(data.readUInt32LE(at + 16));
    at += 46 + nameLength;
  }
  return out;
}

it('computes standard CRC32 checksum', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

it('zips multiple files and reads back Chinese filenames and contents intact', async () => {
  const blob = zipStore([{ name: '周报.html', data: new TextEncoder().encode('<p>这周</p>') },
    { name: '读书会.pdf', data: new TextEncoder().encode('%PDF') }]);
  expect(blob.type).toBe('application/zip');
  expect(readBack(Buffer.from(await blob.arrayBuffer()))).toEqual({ '周报.html': '<p>这周</p>', '读书会.pdf': '%PDF' });
});
