// 读一个 zip（.docx / .xlsx / .pptx 都是 zip，导入、读附件都用）：读末尾的中央目录，按名字取一个文件；deflate 的用
// node:zlib 解开，限住解开后的大小（防压缩炸弹）。不是 zip、目录坏了是 null；某个文件没有、加密、解不开也是 null。

import { inflateRawSync } from 'node:zlib';

const LOCAL_ENTRY = 0x04034b50;
const CENTRAL_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
/** 目录结尾的记录 22 字节，后面最多跟 65535 字节的注释。 */
const END_SEARCH_BYTES = 65_557;
/** 一个文件解开后默认最多这么大。 */
export const ZIP_ENTRY_MAX_BYTES = 32 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  offset: number;
}

export interface ZipArchive {
  /** 里面的文件名，按目录里的顺序。 */
  names(): string[];
  /** 一个文件的字节；没有这个文件、解不开、超过 maxBytes 是 null。 */
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

/** 打开一个 zip；不是 zip 或目录读不了是 null。 */
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
