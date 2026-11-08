// PalmDOC LZ77 decompression and the trailing entries MOBI appends to text records (MobileRead wiki, "PalmDOC" and
// "MOBI": extra record data flags). Both work on one text record at a time.

import { corrupt } from './errors.ts';

// A record holds 4096 bytes of text; the densest token (a 2-byte back reference) expands to 10 bytes, so a valid
// record never comes close to this. It bounds memory if a crafted record tries.
const RECORD_OUTPUT_MAX = 64 * 1024;

export function decompressPalmDoc(data: Buffer): Buffer {
  const out = Buffer.alloc(Math.min(RECORD_OUTPUT_MAX, data.length * 10));
  let length = 0;
  const put = (byte: number): void => {
    if (length >= out.length) {
      throw corrupt(new Error('PalmDOC record expands past its limit'));
    }
    out[length] = byte;
    length += 1;
  };
  let at = 0;
  while (at < data.length) {
    const byte = data[at] ?? 0;
    at += 1;
    if (byte >= 1 && byte <= 8) {
      // A run of `byte` literal bytes follows.
      for (let copied = 0; copied < byte && at < data.length; copied += 1) {
        put(data[at] ?? 0);
        at += 1;
      }
    } else if (byte < 0x80) {
      put(byte);
    } else if (byte >= 0xc0) {
      // A space followed by the character byte ^ 0x80.
      put(0x20);
      put(byte ^ 0x80);
    } else {
      const pair = ((byte << 8) | (data[at] ?? 0)) & 0x3fff;
      at += 1;
      const distance = pair >> 3;
      const count = (pair & 0x07) + 3;
      if (distance === 0 || distance > length) {
        throw corrupt(new Error('PalmDOC back reference before the start of the record'));
      }
      for (let copied = 0; copied < count; copied += 1) {
        put(out[length - distance] ?? 0);
      }
    }
  }
  return out.subarray(0, length);
}

/** The size of one trailing entry: a varint stored backwards, its last byte first, 0x80 marking the end. */
function trailingEntrySize(record: Buffer, end: number): number {
  let size = 0;
  let shift = 0;
  let at = end;
  while (at > 0) {
    const byte = record[at - 1] ?? 0;
    size |= (byte & 0x7f) << shift;
    shift += 7;
    at -= 1;
    if ((byte & 0x80) !== 0 || shift >= 28) {
      break;
    }
  }
  return size;
}

/**
 * Bytes at the end of a text record that are not text. Bits 1.. of the flags each announce one sized entry (TBS
 * indexing and friends), removed last-first; bit 0 announces the multibyte overlap, sized by its low two bits.
 */
export function trailingEntriesSize(record: Buffer, extraFlags: number): number {
  let total = 0;
  for (let flags = extraFlags >> 1; flags !== 0; flags >>= 1) {
    if ((flags & 1) !== 0) {
      total += trailingEntrySize(record, record.length - total);
    }
  }
  if ((extraFlags & 1) !== 0) {
    total += ((record[record.length - total - 1] ?? 0) & 0x03) + 1;
  }
  return Math.min(total, record.length);
}
