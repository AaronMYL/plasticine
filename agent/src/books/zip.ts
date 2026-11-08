// Reads the ZIP container of an EPUB: the central directory (ZIP64 included), stored and deflated entries. Entries
// are inflated only when asked for, and sizes are checked before and during inflation so a crafted archive cannot
// make the server allocate gigabytes.

import { crc32, inflateRawSync } from 'node:zlib';
import { BOOK_MESSAGES, BookParseError, corrupt } from './errors.ts';

const MEGABYTE = 1024 * 1024;
// Same as the upload limit: no single file inside a book needs to be bigger than the whole upload may be.
export const ZIP_ENTRY_MAX_BYTES = 100 * MEGABYTE;
// A 100 MB upload that unpacks past 500 MB is a zip bomb, not a book (task brief).
export const ZIP_TOTAL_MAX_BYTES = 500 * MEGABYTE;
// Real EPUBs hold hundreds to a few thousand files; tens of thousands means a hostile or broken archive.
const ZIP_MAX_ENTRIES = 50_000;

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const ZIP64_EXTRA = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const SIZE_IN_ZIP64 = 0xffffffff;

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

interface Directory {
  count: number;
  offset: number;
  size: number;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw corrupt(new Error('ZIP64 value out of range'));
  }
  return Number(value);
}

function findEndRecord(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - END_RECORD_SIZE - MAX_COMMENT);
  for (let at = bytes.length - END_RECORD_SIZE; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === END_OF_DIRECTORY) {
      return at;
    }
  }
  throw corrupt(new Error('no end of central directory record'));
}

function readDirectory(bytes: Buffer): Directory {
  const end = findEndRecord(bytes);
  const directory = {
    count: bytes.readUInt16LE(end + 10),
    size: bytes.readUInt32LE(end + 12),
    offset: bytes.readUInt32LE(end + 16),
  };
  const locator = end - 20;
  const needsZip64 = directory.count === 0xffff || directory.offset === SIZE_IN_ZIP64;
  if (needsZip64 && locator >= 0 && bytes.readUInt32LE(locator) === ZIP64_LOCATOR) {
    const record = safeNumber(bytes.readBigUInt64LE(locator + 8));
    if (record + 56 > bytes.length || bytes.readUInt32LE(record) !== ZIP64_END_OF_DIRECTORY) {
      throw corrupt(new Error('bad ZIP64 end of central directory'));
    }
    directory.count = safeNumber(bytes.readBigUInt64LE(record + 32));
    directory.size = safeNumber(bytes.readBigUInt64LE(record + 40));
    directory.offset = safeNumber(bytes.readBigUInt64LE(record + 48));
  }
  if (directory.offset + directory.size > bytes.length) {
    throw corrupt(new Error('central directory outside the file'));
  }
  return directory;
}

function decodeName(raw: Buffer, flags: number): string {
  if ((flags & FLAG_UTF8) !== 0) {
    return raw.toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch (error) {
    // Chinese archivers write GBK names without the UTF-8 flag; GB18030 is a superset of GBK.
    if (error instanceof TypeError) {
      return new TextDecoder('gb18030').decode(raw);
    }
    throw error;
  }
}

/** The ZIP64 extra field replaces whichever of the three 32-bit fields were written as 0xFFFFFFFF, in order. */
function applyZip64(entry: Entry, extra: Buffer): void {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === ZIP64_EXTRA) {
      let field = at + 4;
      const next = (): number => {
        const value = safeNumber(extra.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      if (entry.size === SIZE_IN_ZIP64) {
        entry.size = next();
      }
      if (entry.compressedSize === SIZE_IN_ZIP64) {
        entry.compressedSize = next();
      }
      if (entry.localOffset === SIZE_IN_ZIP64) {
        entry.localOffset = next();
      }
      return;
    }
    at += 4 + length;
  }
}

function readEntries(bytes: Buffer, directory: Directory): Entry[] {
  if (directory.count > ZIP_MAX_ENTRIES) {
    throw corrupt(new Error(`too many entries: ${directory.count}`));
  }
  const entries: Entry[] = [];
  let at = directory.offset;
  let total = 0;
  for (let index = 0; index < directory.count; index += 1) {
    if (at + CENTRAL_HEADER_SIZE > bytes.length || bytes.readUInt32LE(at) !== CENTRAL_ENTRY) {
      throw corrupt(new Error(`bad central directory entry ${index}`));
    }
    const flags = bytes.readUInt16LE(at + 8);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const nameStart = at + CENTRAL_HEADER_SIZE;
    const entry: Entry = {
      name: decodeName(bytes.subarray(nameStart, nameStart + nameLength), flags).replaceAll('\\', '/'),
      flags,
      method: bytes.readUInt16LE(at + 10),
      crc: bytes.readUInt32LE(at + 16),
      compressedSize: bytes.readUInt32LE(at + 20),
      size: bytes.readUInt32LE(at + 24),
      localOffset: bytes.readUInt32LE(at + 42),
    };
    applyZip64(entry, bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength));
    at = nameStart + nameLength + extraLength + commentLength;
    if (entry.name.endsWith('/')) {
      continue;
    }
    total += entry.size;
    if (entry.size > ZIP_ENTRY_MAX_BYTES || total > ZIP_TOTAL_MAX_BYTES) {
      throw new BookParseError('too_large', BOOK_MESSAGES.unpackedTooLarge);
    }
    entries.push(entry);
  }
  return entries;
}

function inflate(entry: Entry, data: Buffer): Buffer {
  if (entry.method === METHOD_STORED) {
    return data;
  }
  if (entry.size === 0) {
    return Buffer.alloc(0);
  }
  try {
    // The declared size caps the output, so an entry that lies about its size fails instead of growing.
    return inflateRawSync(data, { maxOutputLength: entry.size });
  } catch (error) {
    throw corrupt(new Error(`cannot inflate ${entry.name}`, { cause: error }));
  }
}

export class ZipArchive {
  readonly #bytes: Buffer;
  readonly #entries = new Map<string, Entry>();
  readonly #folded = new Map<string, Entry>();

  constructor(bytes: Buffer, entries: Entry[]) {
    this.#bytes = bytes;
    for (const entry of entries) {
      this.#entries.set(entry.name, entry);
      const folded = entry.name.toLowerCase();
      if (!this.#folded.has(folded)) {
        this.#folded.set(folded, entry);
      }
    }
  }

  names(): string[] {
    return [...this.#entries.keys()];
  }

  /** The entry's bytes, or null when there is no such entry; paths fall back to a case-insensitive match. */
  read(name: string): Buffer | null {
    const entry = this.#entries.get(name) ?? this.#folded.get(name.toLowerCase());
    if (entry === undefined) {
      return null;
    }
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
      throw new BookParseError('drm', BOOK_MESSAGES.drm);
    }
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new BookParseError('unsupported', BOOK_MESSAGES.unsupportedCompression);
    }
    const bytes = this.#bytes;
    const local = entry.localOffset;
    if (local + LOCAL_HEADER_SIZE > bytes.length || bytes.readUInt32LE(local) !== LOCAL_ENTRY) {
      throw corrupt(new Error(`bad local header for ${entry.name}`));
    }
    const start = local + LOCAL_HEADER_SIZE + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + entry.compressedSize > bytes.length) {
      throw corrupt(new Error(`${entry.name} runs past the end of the file`));
    }
    const data = inflate(entry, bytes.subarray(start, start + entry.compressedSize));
    if (data.length !== entry.size || crc32(data) !== entry.crc) {
      throw corrupt(new Error(`${entry.name} fails its size or CRC check`));
    }
    return data;
  }
}

export function readZip(bytes: Buffer): ZipArchive {
  if (bytes.length < END_RECORD_SIZE) {
    throw corrupt(new Error('too short for a ZIP file'));
  }
  return new ZipArchive(bytes, readEntries(bytes, readDirectory(bytes)));
}
