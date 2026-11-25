import { inflateRawSync } from 'node:zlib';

const LOCAL_ENTRY = 0x04034b50;
const CENTRAL_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_SEARCH_BYTES = 65_557;
export const ZIP_ENTRY_MAX_BYTES = 32 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  offset: number;
}

export interface ZipArchive {
  names(): string[];
  read(name: string, maxBytes?: number): Buffer | null;
}

function centralDirectory(data: Buffer): Map<string, ZipEntry> | null {
  const from = Math.max(0, data.length - END_SEARCH_BYTES);
  let end = -1;
  for (let at = data.length - 22; at >= from; at -= 1) {
    if (data.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL_ENTRY) return null;
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, { method: data.readUInt16LE(at + 10), compressedSize: data.readUInt32LE(at + 20),
      offset: data.readUInt32LE(at + 42) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryBytes(data: Buffer, entry: ZipEntry, maxBytes: number): Buffer | null {
  const at = entry.offset;
  if (at + 30 > data.length || data.readUInt32LE(at) !== LOCAL_ENTRY) return null;
  const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.length > maxBytes ? null : raw;
  if (entry.method !== 8) return null;
  try {
    return inflateRawSync(raw, { maxOutputLength: maxBytes });
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && 'code' in error)) return null;
    throw error;
  }
}

export function openZip(data: Buffer): ZipArchive | null {
  if (data.length < 22 || data.readUInt32LE(0) !== LOCAL_ENTRY) return null;
  const entries = centralDirectory(data);
  if (entries === null) return null;
  return {
    names: () => [...entries.keys()],
    read(name, maxBytes = ZIP_ENTRY_MAX_BYTES) {
      const entry = entries.get(name);
      return entry === undefined ? null : entryBytes(data, entry, maxBytes);
    },
  };
}
