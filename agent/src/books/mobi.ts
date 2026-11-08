// MOBI and AZW3. MOBI6 text is one HTML stream split by <mbp:pagebreak/>, images by recindex. KF8 (AZW3, or the
// KF8 half of a joint MOBI found via EXTH 121) stores per-file skeletons each followed by their fragments; here
// the stream is read in stored order and cut at each file's <html>, without the SKEL/FRAG index reassembly.

import { firstHeading } from './blocks.ts';
import { cleanMetadata, joinAuthors } from './draft.ts';
import type { DraftBook, DraftChapter } from './draft.ts';
import { BOOK_MESSAGES, BookParseError, corrupt } from './errors.ts';
import { ImageCollector, sniffImageMime } from './images.ts';
import { tokenize } from './markup.ts';
import { normalizeMarkup } from './normalize.ts';
import type { ImageResolver } from './normalize.ts';
import { decompressPalmDoc, trailingEntriesSize } from './palmdoc.ts';
import { decodeMobiText, exthNumber, NO_RECORD, readMobiHeader, readPdb } from './pdb.ts';
import type { MobiHeader, PdbFile } from './pdb.ts';

const COMPRESSION_NONE = 1;
const COMPRESSION_PALMDOC = 2;
const COMPRESSION_HUFF_CDIC = 17480;
const EXTH_AUTHOR = 100;
const EXTH_KF8_BOUNDARY = 121;
const EXTH_COVER_OFFSET = 201;
const EXTH_UPDATED_TITLE = 503;
const EXTH_LANGUAGE = 524;
const PAGEBREAK = /<mbp:pagebreak\b[^>]*>/gi;
const KF8_FILE_START = /<html[\s>]/gi;
// kindle:embed:XXXX numbers resources from 1 in base 32 with digits 0-9A-V (KindleUnpack).
const KINDLE_EMBED = /kindle:embed:([0-9a-v]{4})/i;
const RECINDEX_ATTRIBUTES = ['recindex', 'hirecindex', 'lorecindex'];

interface MobiParts {
  pdb: PdbFile;
  first: MobiHeader;
  /** The header whose text is read: record 0's, or the KF8 part's in a joint file. */
  content: MobiHeader;
  /** Record number of `content`'s header; null when only MOBI6 text is used. */
  kf8Base: number | null;
}

function checkReadable(header: MobiHeader): void {
  if (header.encryption !== 0) {
    throw new BookParseError('drm', BOOK_MESSAGES.drm);
  }
  if (header.compression === COMPRESSION_HUFF_CDIC) {
    throw new BookParseError('unsupported', BOOK_MESSAGES.unsupportedHuff);
  }
  if (header.compression !== COMPRESSION_NONE && header.compression !== COMPRESSION_PALMDOC) {
    throw new BookParseError('unsupported', BOOK_MESSAGES.unsupportedCompression);
  }
}

function kf8HeaderAt(pdb: PdbFile, index: number): MobiHeader | null {
  const record = pdb.records[index];
  if (record === undefined || record.subarray(16, 20).toString('latin1') !== 'MOBI') {
    return null;
  }
  const header = readMobiHeader(record);
  return header.version >= 8 ? header : null;
}

/** Finds the headers and which part's text to read; no DRM or compression checks yet (detection uses this). */
function locateParts(bytes: Buffer): MobiParts {
  const pdb = readPdb(bytes);
  const record0 = pdb.records[0];
  if (pdb.kind !== 'BOOKMOBI' || record0 === undefined) {
    throw new BookParseError('unsupported', BOOK_MESSAGES.unsupportedFormat);
  }
  const first = readMobiHeader(record0);
  if (first.version >= 8) {
    return { pdb, first, content: first, kf8Base: 0 };
  }
  const boundary = exthNumber(first, EXTH_KF8_BOUNDARY);
  const kf8 = boundary === null || boundary === 0 ? null : kf8HeaderAt(pdb, boundary);
  if (boundary === null || kf8 === null) {
    return { pdb, first, content: first, kf8Base: null };
  }
  return { pdb, first, content: kf8, kf8Base: boundary };
}

/** 'azw3' when the file carries KF8 text that parseMobi would use, else 'mobi'. */
export function mobiFormatOf(bytes: Buffer): 'mobi' | 'azw3' {
  return locateParts(bytes).kf8Base === null ? 'mobi' : 'azw3';
}

/** The raw (still encoded) text of the content header's records, trailing entries removed. */
function readText(parts: MobiParts): Buffer {
  const { pdb, content } = parts;
  const base = parts.kf8Base ?? 0;
  const chunks: Buffer[] = [];
  for (let index = 1; index <= content.textRecordCount; index += 1) {
    const record = pdb.records[base + index];
    if (record === undefined) {
      throw corrupt(new Error(`text record ${index} is missing`));
    }
    const text = record.subarray(0, record.length - trailingEntriesSize(record, content.extraFlags));
    chunks.push(content.compression === COMPRESSION_PALMDOC ? decompressPalmDoc(text) : text);
  }
  const text = Buffer.concat(chunks);
  return text.length > content.textLength ? text.subarray(0, content.textLength) : text;
}

/** KF8 text holds several flows (HTML, then CSS and SVG); the FDST record says where flow 0, the HTML, ends. */
function firstFlow(parts: MobiParts, text: Buffer): Buffer {
  const index = parts.content.fdstIndex;
  const fdst = index === NO_RECORD ? undefined : parts.pdb.records[(parts.kf8Base ?? 0) + index];
  if (fdst === undefined || fdst.length < 12 || fdst.subarray(0, 4).toString('latin1') !== 'FDST') {
    return text;
  }
  const tableOffset = fdst.readUInt32BE(4);
  const count = fdst.readUInt32BE(8);
  if (count < 1 || tableOffset + 8 > fdst.length) {
    return text;
  }
  const start = fdst.readUInt32BE(tableOffset);
  const end = fdst.readUInt32BE(tableOffset + 4);
  return start <= end && end <= text.length ? text.subarray(start, end) : text;
}

/**
 * The record of resource 1. Joint files disagree on whether the KF8 header counts from its own record or from
 * the file start (or leaves it unset and shares the MOBI6 resources), so each reading is tried and an image wins.
 */
function resourceStart(parts: MobiParts): number | null {
  const { pdb, first, content } = parts;
  const base = parts.kf8Base ?? 0;
  const candidates: number[] = [];
  if (content.firstImageIndex !== NO_RECORD) {
    candidates.push(base + content.firstImageIndex, content.firstImageIndex);
  }
  if (first.firstImageIndex !== NO_RECORD) {
    candidates.push(first.firstImageIndex);
  }
  const valid = candidates.filter((index) => index > 0 && index < pdb.records.length);
  const image = valid.find((index) => sniffImageMime(pdb.records[index] ?? Buffer.alloc(0)) !== null);
  return image ?? valid[0] ?? null;
}

function mobi6Resolver(images: ImageCollector, start: number | null): ImageResolver {
  return (attributes) => {
    const value = RECINDEX_ATTRIBUTES.map((name) => attributes.get(name)).find((found) => found !== undefined);
    const number = value === undefined ? Number.NaN : Number.parseInt(value, 10);
    if (start === null || !Number.isInteger(number) || number < 1) {
      return null;
    }
    return images.keyFor(String(start + number - 1));
  };
}

function kf8Resolver(images: ImageCollector, start: number | null): ImageResolver {
  return (attributes) => {
    const source = attributes.get('src') ?? attributes.get('xlink:href') ?? attributes.get('href') ?? '';
    const code = KINDLE_EMBED.exec(source)?.[1];
    if (start === null || code === undefined) {
      return null;
    }
    return images.keyFor(String(start + Number.parseInt(code, 32) - 1));
  };
}

/** Splits at every match of `pattern`, keeping the match at the start of the next piece. */
function splitBefore(text: string, pattern: RegExp): string[] {
  const starts = [0, ...[...text.matchAll(pattern)].map((match) => match.index)];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
}

function chaptersOf(pieces: string[], resolve: ImageResolver): DraftChapter[] {
  return pieces.map((piece) => {
    const document = normalizeMarkup(tokenize(piece), resolve);
    return { title: firstHeading(document.blocks), blocks: document.blocks, imageKeys: document.imageKeys };
  });
}

function exthText(parts: MobiParts, type: number): string[] {
  for (const header of [parts.content, parts.first]) {
    const values = header.exth.get(type);
    if (values !== undefined && values.length > 0) {
      return values.map((value) => decodeMobiText(value, header.encoding));
    }
  }
  return [];
}

function coverOffset(parts: MobiParts): number | null {
  const offset = exthNumber(parts.content, EXTH_COVER_OFFSET) ?? exthNumber(parts.first, EXTH_COVER_OFFSET);
  return offset === NO_RECORD ? null : offset;
}

export function parseMobi(bytes: Buffer): DraftBook {
  const parts = locateParts(bytes);
  checkReadable(parts.first);
  checkReadable(parts.content);
  const { pdb } = parts;
  const images = new ImageCollector((reference) => pdb.records[Number(reference)] ?? null);
  const start = resourceStart(parts);
  const raw = readText(parts);
  const isKf8 = parts.kf8Base !== null;
  const html = decodeMobiText(isKf8 ? firstFlow(parts, raw) : raw, parts.content.encoding);
  const chapters = isKf8
    ? chaptersOf(splitBefore(html, KF8_FILE_START), kf8Resolver(images, start))
    : chaptersOf(html.split(PAGEBREAK), mobi6Resolver(images, start));
  const offset = coverOffset(parts);
  const coverKey = start === null || offset === null ? null : images.keyFor(String(start + offset));
  return {
    format: isKf8 ? 'azw3' : 'mobi',
    title: cleanMetadata(exthText(parts, EXTH_UPDATED_TITLE)[0]) ?? cleanMetadata(parts.content.fullName)
      ?? cleanMetadata(pdb.name),
    author: joinAuthors(exthText(parts, EXTH_AUTHOR)),
    language: cleanMetadata(exthText(parts, EXTH_LANGUAGE)[0]),
    coverKey,
    chapters,
    images,
  };
}
