// Builds book files in memory for the books/ tests: a tiny ZIP writer, EPUB assembly, a PalmDOC compressor and a
// PDB / MOBI writer, plus the checks every parsed chapter must pass. No binary fixture files are kept on disk.

import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import type { ParsedBook } from '../../src/books/index.ts';

// ---------------------------------------------------------------------------------------------------------------
// ZIP

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  /** Stored instead of deflated (the EPUB mimetype entry must be stored). */
  store?: boolean;
  /** Overrides the uncompressed size written in the headers, to fake a zip bomb. */
  declaredSize?: number;
  /** Overrides the CRC, to fake a damaged entry. */
  crc?: number;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const method = entry.store === true ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = entry.crc ?? crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/** An EPUB: the stored mimetype first, then container.xml (unless given), then the files in order. */
export function makeEpub(files: Record<string, string | Buffer>): Buffer {
  const entries: ZipEntry[] = [{ name: 'mimetype', data: 'application/epub+zip', store: true }];
  if (files['META-INF/container.xml'] === undefined) {
    entries.push({ name: 'META-INF/container.xml', data: CONTAINER_XML });
  }
  for (const [name, data] of Object.entries(files)) {
    entries.push({ name, data });
  }
  return makeZip(entries);
}

export function xhtml(body: string, title = '章节'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><style>p { text-indent: 2em; }</style></head>
<body>
${body}
</body>
</html>`;
}

/** Enough of a PNG for the signature sniff; `tag` keeps different images different. */
export function fakePng(tag: string): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
}

export function fakeJpeg(tag: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);
}

// ---------------------------------------------------------------------------------------------------------------
// PalmDOC and MOBI

// PalmDOC back references reach 2047 bytes back and copy 3 to 10 bytes (MobileRead wiki, "PalmDOC").
const PALMDOC_WINDOW = 2047;
const PALMDOC_MAX_MATCH = 10;
export const PALMDOC_RECORD_SIZE = 4096;

function longestMatch(input: Buffer, at: number): { length: number; distance: number } {
  let best = { length: 0, distance: 0 };
  const limit = Math.min(PALMDOC_MAX_MATCH, input.length - at);
  for (let start = Math.max(0, at - PALMDOC_WINDOW); start < at; start += 1) {
    let length = 0;
    while (length < limit && input[start + length] === input[at + length]) {
      length += 1;
    }
    if (length > best.length) {
      best = { length, distance: at - start };
    }
  }
  return best;
}

function needsEscape(byte: number): boolean {
  return (byte >= 1 && byte <= 8) || byte >= 0x80;
}

/** A greedy PalmDOC LZ77 compressor that uses every token type the decompressor knows. */
export function palmdocCompress(input: Buffer): Buffer {
  const out: number[] = [];
  let at = 0;
  while (at < input.length) {
    const match = longestMatch(input, at);
    if (match.length >= 3) {
      const pair = (match.distance << 3) | (match.length - 3);
      out.push(0x80 | (pair >> 8), pair & 0xff);
      at += match.length;
      continue;
    }
    const byte = input[at] ?? 0;
    const next = input[at + 1];
    if (byte === 0x20 && next !== undefined && next >= 0x40 && next <= 0x7f) {
      out.push(next ^ 0x80);
      at += 2;
      continue;
    }
    if (!needsEscape(byte)) {
      out.push(byte);
      at += 1;
      continue;
    }
    const run: number[] = [];
    while (run.length < 8 && at < input.length && needsEscape(input[at] ?? 0)) {
      run.push(input[at] ?? 0);
      at += 1;
    }
    out.push(run.length, ...run);
  }
  return Buffer.from(out);
}

/** Text records as a MOBI writer makes them, with the trailing entries the extra-data flags announce. */
export function textRecords(text: Buffer, compression: number, extraFlags: number): Buffer[] {
  const records: Buffer[] = [];
  for (let start = 0; start < text.length; start += PALMDOC_RECORD_SIZE) {
    const chunk = text.subarray(start, start + PALMDOC_RECORD_SIZE);
    const parts = [compression === 2 ? palmdocCompress(chunk) : chunk];
    if ((extraFlags & 1) !== 0) {
      // Two bytes of a "split character" and the count byte; the reader drops all three.
      parts.push(Buffer.from([0xaa, 0xbb, 0x02]));
    }
    if ((extraFlags & 2) !== 0) {
      // One TBS byte and its size, written backwards-varint style (0x80 marks the last byte).
      parts.push(Buffer.from([0x00, 0x82]));
    }
    records.push(Buffer.concat(parts));
  }
  return records;
}

export interface MobiHeaderOptions {
  compression: number;
  textLength: number;
  textRecordCount: number;
  encryption?: number;
  version: number;
  encoding?: number;
  fullName: string;
  firstImageIndex: number;
  exth: Array<[number, Buffer | string | number]>;
  extraFlags?: number;
  fdstIndex?: number;
}

const MOBI_HEADER_LENGTH = 0xe8;

export function mobiHeaderRecord(options: MobiHeaderOptions): Buffer {
  const head = Buffer.alloc(16 + MOBI_HEADER_LENGTH);
  head.writeUInt16BE(options.compression, 0);
  head.writeUInt32BE(options.textLength, 4);
  head.writeUInt16BE(options.textRecordCount, 8);
  head.writeUInt16BE(PALMDOC_RECORD_SIZE, 10);
  head.writeUInt16BE(options.encryption ?? 0, 12);
  head.write('MOBI', 16, 'latin1');
  head.writeUInt32BE(MOBI_HEADER_LENGTH, 20);
  head.writeUInt32BE(2, 24);
  head.writeUInt32BE(options.encoding ?? 65001, 28);
  head.writeUInt32BE(options.version, 36);
  head.fill(0xff, 40, 80);
  head.writeUInt32BE(options.textRecordCount + 1, 80);
  head.writeUInt32BE(options.version, 104);
  head.writeUInt32BE(options.firstImageIndex, 108);
  head.writeUInt32BE(0x40, 128);
  head.writeUInt32BE(options.version === 8 ? (options.fdstIndex ?? 0xffffffff) : 1, 192);
  head.writeUInt32BE(options.extraFlags ?? 0, 240);
  const records = options.exth.map(([type, value]) => {
    let data: Buffer;
    if (typeof value === 'number') {
      data = Buffer.alloc(4);
      data.writeUInt32BE(value, 0);
    } else {
      data = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    }
    const header = Buffer.alloc(8);
    header.writeUInt32BE(type, 0);
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const exthBody = Buffer.concat(records);
  const exthHead = Buffer.alloc(12);
  exthHead.write('EXTH', 0, 'latin1');
  exthHead.writeUInt32BE(12 + exthBody.length, 4);
  exthHead.writeUInt32BE(records.length, 8);
  const exthPadding = Buffer.alloc((4 - (exthBody.length % 4)) % 4);
  const name = Buffer.from(options.fullName, 'utf8');
  const nameOffset = head.length + exthHead.length + exthBody.length + exthPadding.length;
  head.writeUInt32BE(nameOffset, 84);
  head.writeUInt32BE(name.length, 88);
  return Buffer.concat([head, exthHead, exthBody, exthPadding, name, Buffer.alloc(4)]);
}

export function makePdb(name: string, records: Buffer[]): Buffer {
  const header = Buffer.alloc(78);
  header.write(name.slice(0, 31), 0, 'latin1');
  header.write('BOOKMOBI', 60, 'latin1');
  header.writeUInt16BE(records.length, 76);
  const list = Buffer.alloc(records.length * 8 + 2);
  let offset = header.length + list.length;
  records.forEach((record, index) => {
    list.writeUInt32BE(offset, index * 8);
    list.writeUInt32BE(index * 2, index * 8 + 4);
    offset += record.length;
  });
  return Buffer.concat([header, list, ...records]);
}

export function fdstRecord(flows: Array<[number, number]>): Buffer {
  const record = Buffer.alloc(12 + flows.length * 8);
  record.write('FDST', 0, 'latin1');
  record.writeUInt32BE(12, 4);
  record.writeUInt32BE(flows.length, 8);
  flows.forEach(([start, end], index) => {
    record.writeUInt32BE(start, 12 + index * 8);
    record.writeUInt32BE(end, 16 + index * 8);
  });
  return record;
}

export const EOF_RECORD = Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]);

export interface MobiOptions {
  html: string;
  fullName: string;
  exth?: Array<[number, Buffer | string | number]>;
  images?: Buffer[];
  compression?: number;
  encryption?: number;
  extraFlags?: number;
  /** 8 makes a stand-alone KF8 (AZW3) file; `css` then becomes a second FDST flow. */
  version?: number;
  css?: string;
}

/** Record layout: header, text records, images, then FDST (KF8 only) and the EOF marker. */
export function makeMobi(options: MobiOptions): Buffer {
  const compression = options.compression ?? 2;
  const extraFlags = options.extraFlags ?? 0;
  const version = options.version ?? 6;
  const html = Buffer.from(options.html, 'utf8');
  const css = Buffer.from(options.css ?? '', 'utf8');
  const text = version === 8 ? Buffer.concat([html, css]) : html;
  const texts = textRecords(text, compression, extraFlags);
  const images = options.images ?? [];
  const firstImageIndex = images.length > 0 ? texts.length + 1 : 0xffffffff;
  const fdstIndex = texts.length + 1 + images.length;
  const header = mobiHeaderRecord({
    compression,
    textLength: text.length,
    textRecordCount: texts.length,
    encryption: options.encryption ?? 0,
    version,
    fullName: options.fullName,
    firstImageIndex,
    exth: options.exth ?? [],
    extraFlags,
    fdstIndex,
  });
  const tail = version === 8 ? [fdstRecord([[0, html.length], [html.length, text.length]])] : [];
  return makePdb(options.fullName, [header, ...texts, ...images, ...tail, EOF_RECORD]);
}

// ---------------------------------------------------------------------------------------------------------------
// Checks every parsed book must pass

const BLOCKS = new Set(['h2', 'h3', 'h4', 'p', 'blockquote', 'ul', 'ol', 'li', 'pre', 'hr']);
const INLINES = new Set(['em', 'strong', 'sub', 'sup', 'ruby', 'rt', 'br', 'img']);
const VOIDS = new Set(['hr', 'br', 'img']);
const TAG = /<(\/?)([a-z0-9]+)((?:\s[^>]*)?)>/g;

function decodeFour(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

/** Which parents a block may have: none at the top, li only in a list, p also in blockquote. */
function allowedParent(name: string, parent: string | undefined): boolean {
  if (name === 'li') {
    return parent === 'ul' || parent === 'ol';
  }
  if (name === 'p') {
    return parent === undefined || parent === 'blockquote';
  }
  return parent === undefined;
}

function checkChapterHtml(html: string, keys: Set<string>, where: string): void {
  const stack: string[] = [];
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    const [whole, slash, name = '', attributes = ''] = match;
    const between = html.slice(last, match.index);
    last = match.index + whole.length;
    const inPre = stack.includes('pre');
    assert.ok(inPre || !between.includes('\n'), `${where}: 换行出现在 pre 外：${JSON.stringify(between)}`);
    assert.ok(!/[<>]/.test(between), `${where}: 文本里有没转义的尖括号`);
    const parent = stack.at(-1);
    if (between.length > 0) {
      assert.ok(parent !== undefined && !['ul', 'ol', 'blockquote'].includes(parent), `${where}: 块之间有文字`);
    }
    assert.ok(BLOCKS.has(name) || INLINES.has(name), `${where}: 不允许的标签 <${name}>`);
    if (name === 'img') {
      const image = /^ data-asset="([A-Za-z0-9_-]{1,64})" alt="[^"]*"$/.exec(attributes);
      assert.ok(image !== null, `${where}: img 属性不对：${attributes}`);
      assert.ok(keys.has(image[1] ?? ''), `${where}: img 指向不存在的图片 ${image[1]}`);
    } else {
      assert.equal(attributes, '', `${where}: <${name}> 不该有属性`);
    }
    if (slash === '/') {
      assert.equal(stack.pop(), name, `${where}: </${name}> 没对上`);
      continue;
    }
    if (BLOCKS.has(name)) {
      assert.ok(allowedParent(name, parent), `${where}: <${name}> 嵌在 <${parent}> 里`);
    } else {
      const inBlock = parent !== undefined && !['ul', 'ol', 'blockquote'].includes(parent);
      assert.ok(inBlock, `${where}: 行内 <${name}> 不在块里`);
    }
    if (!VOIDS.has(name)) {
      stack.push(name);
    }
  }
  assert.equal(html.slice(last), '', `${where}: 结尾有块外文字`);
  assert.deepEqual(stack, [], `${where}: 有没关闭的标签`);
}

/** html↔text consistency, allowed tags and attributes, image keys, and the book-level invariants. */
export function assertWellFormed(book: ParsedBook): void {
  assert.ok(book.chapters.length > 0, '章节不能为空');
  const keys = new Set(book.images.map((image) => image.key));
  assert.equal(keys.size, book.images.length, '图片 key 要唯一');
  for (const image of book.images) {
    assert.match(image.key, /^[A-Za-z0-9_-]{1,64}$/);
    assert.match(image.mime, /^image\//);
  }
  if (book.cover !== null) {
    assert.ok(keys.has(book.cover.key), '封面要在 images 里');
  }
  book.chapters.forEach((chapter, index) => {
    const where = `第 ${index + 1} 章「${chapter.title}」`;
    assert.ok(chapter.title.length > 0, `${where}: 标题为空`);
    assert.ok(chapter.text.length > 0, `${where}: 正文为空`);
    assert.equal(decodeFour(chapter.html.replace(/<[^>]*>/g, '')), chapter.text, `${where}: html 与 text 不一致`);
    checkChapterHtml(chapter.html, keys, where);
  });
}
