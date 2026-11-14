// Word、Excel、PowerPoint 读成文字（第13批，11-14 弹框同意：不加新包，自己读文件里的 XML）。.docx / .xlsx / .pptx
// 都是 zip：读末尾的中央目录找到要的那几个文件，按 deflate 解开（node:zlib，限住解开后的大小，防压缩炸弹），从 XML 里
// 取字——Word 按段落，Excel 按表、行（格子之间用制表符），PowerPoint 按页。读不了（不是 zip、缺文件、加密）就是 null。

import { inflateRawSync } from 'node:zlib';

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

export const OFFICE_TYPES: Readonly<Record<string, OfficeKind>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** 一个 XML 解开后最多这么大。 */
const ENTRY_MAX_BYTES = 32 * 1024 * 1024;
/** 最多读这么多张表、这么多页。 */
const PARTS_MAX = 200;

interface ZipEntry {
  method: number;
  compressedSize: number;
  offset: number;
}

function centralDirectory(data: Buffer): Map<string, ZipEntry> | null {
  const from = Math.max(0, data.length - 65_557);
  let end = -1;
  for (let at = data.length - 22; at >= from; at -= 1) {
    if (data.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return null;
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

function entryText(data: Buffer, entry: ZipEntry): string | null {
  const at = entry.offset;
  if (at + 30 > data.length || data.readUInt32LE(at) !== 0x04034b50) return null;
  const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.length > ENTRY_MAX_BYTES ? null : raw.toString('utf8');
  if (entry.method !== 8) return null;
  try {
    return inflateRawSync(raw, { maxOutputLength: ENTRY_MAX_BYTES }).toString('utf8');
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && 'code' in error)) return null;
    throw error;
  }
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const value = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
  });
}

/** 一段 XML 里某种文字标签（w:t、a:t、t）的字，按出现顺序接起来。 */
function textsOf(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? '')).join('');
}

function numbered(entries: Map<string, ZipEntry>, pattern: RegExp): string[] {
  return [...entries.keys()].filter((name) => pattern.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0))
    .slice(0, PARTS_MAX);
}

function docxText(data: Buffer, entries: Map<string, ZipEntry>): string | null {
  const entry = entries.get('word/document.xml');
  const xml = entry === undefined ? null : entryText(data, entry);
  if (xml === null) return null;
  return [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((match) => textsOf(match[0]
    .replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>'), 'w:t'))
    .filter((line) => line.trim() !== '').join('\n');
}

function xlsxText(data: Buffer, entries: Map<string, ZipEntry>): string | null {
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const sharedXml = sharedEntry === undefined ? '' : entryText(data, sharedEntry) ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textsOf(match[1] ?? '', 't'));
  const bookEntry = entries.get('xl/workbook.xml');
  const book = bookEntry === undefined ? '' : entryText(data, bookEntry) ?? '';
  const names = [...book.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1] ?? ''));
  const sheets = numbered(entries, /^xl\/worksheets\/sheet\d+\.xml$/);
  if (sheets.length === 0) return null;
  return sheets.map((name, index) => {
    const entry = entries.get(name);
    const xml = entry === undefined ? '' : entryText(data, entry) ?? '';
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...(row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((cell) => {
        const attrs = cell[1] ?? '';
        const inner = cell[2] ?? '';
        if (/\bt="s"/.test(attrs)) return shared[Number(textsOf(inner, 'v'))] ?? '';
        if (/\bt="inlineStr"/.test(attrs)) return textsOf(inner, 't');
        return textsOf(inner, 'v');
      }).join('\t').replace(/\t+$/, '')).filter((line) => line !== '');
    return [`## ${names[index] ?? `表 ${index + 1}`}`, ...rows].join('\n');
  }).join('\n\n');
}

function pptxText(data: Buffer, entries: Map<string, ZipEntry>): string | null {
  const slides = numbered(entries, /^ppt\/slides\/slide\d+\.xml$/);
  if (slides.length === 0) return null;
  return slides.map((name, index) => {
    const entry = entries.get(name);
    const xml = entry === undefined ? '' : entryText(data, entry) ?? '';
    const lines = [...xml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)].map((match) => textsOf(match[0], 'a:t'))
      .filter((line) => line.trim() !== '');
    return [`## 第 ${index + 1} 页`, ...lines].join('\n');
  }).join('\n\n');
}

/** 读成文字；读不了是 null（不是 zip、缺了要的文件、加密）。 */
export function officeText(kind: OfficeKind, data: Buffer): string | null {
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50) return null;
  const entries = centralDirectory(data);
  if (entries === null) return null;
  if (kind === 'docx') return docxText(data, entries);
  if (kind === 'xlsx') return xlsxText(data, entries);
  return pptxText(data, entries);
}
