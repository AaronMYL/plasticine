// The Palm database container of MOBI / AZW3 files and the headers in a book's first record: PalmDOC header, MOBI
// header and EXTH metadata. Offsets follow the MobileRead wiki "MOBI" page; KF8 headers use the same layout.

import { corrupt } from './errors.ts';

const PDB_HEADER_SIZE = 78;
const RECORD_ENTRY_SIZE = 8;
const MOBI_HEADER_START = 16;
const EXTH_FLAG = 0x40;
// Header fields that hold record numbers use this for "none".
export const NO_RECORD = 0xffffffff;
// The extra-data flags only exist in headers at least this long (MobileRead wiki).
const EXTRA_FLAGS_MIN_HEADER = 0xe4;
const UTF8_CODE_PAGE = 65001;

export interface PdbFile {
  name: string;
  /** "BOOKMOBI" for MOBI and AZW3. */
  kind: string;
  records: Buffer[];
}

export interface MobiHeader {
  compression: number;
  textLength: number;
  textRecordCount: number;
  encryption: number;
  encoding: number;
  version: number;
  fullName: string;
  firstImageIndex: number;
  extraFlags: number;
  fdstIndex: number;
  exth: Map<number, Buffer[]>;
}

export function isPdbBook(bytes: Buffer): boolean {
  return bytes.length >= PDB_HEADER_SIZE && bytes.subarray(60, 68).toString('latin1') === 'BOOKMOBI';
}

export function readPdb(bytes: Buffer): PdbFile {
  if (bytes.length < PDB_HEADER_SIZE + 2) {
    throw corrupt(new Error('too short for a Palm database'));
  }
  const count = bytes.readUInt16BE(76);
  const listEnd = PDB_HEADER_SIZE + count * RECORD_ENTRY_SIZE;
  if (count === 0 || listEnd > bytes.length) {
    throw corrupt(new Error('record list outside the file'));
  }
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = bytes.readUInt32BE(PDB_HEADER_SIZE + index * RECORD_ENTRY_SIZE);
    const previous = offsets.at(-1) ?? listEnd;
    if (offset < previous || offset > bytes.length) {
      throw corrupt(new Error(`record ${index} starts outside the file`));
    }
    offsets.push(offset);
  }
  const records = offsets.map((offset, index) => bytes.subarray(offset, offsets[index + 1] ?? bytes.length));
  const name = bytes.subarray(0, 32).toString('latin1').replace(/\0.*$/s, '');
  return { name, kind: bytes.subarray(60, 68).toString('latin1'), records };
}

function readExth(record: Buffer, start: number): Map<number, Buffer[]> {
  const exth = new Map<number, Buffer[]>();
  if (record.subarray(start, start + 4).toString('latin1') !== 'EXTH') {
    throw corrupt(new Error('EXTH flag set but no EXTH block'));
  }
  const count = record.readUInt32BE(start + 8);
  let at = start + 12;
  for (let index = 0; index < count; index += 1) {
    const type = record.readUInt32BE(at);
    const length = record.readUInt32BE(at + 4);
    if (length < 8 || at + length > record.length) {
      throw corrupt(new Error(`EXTH record ${index} runs past the header`));
    }
    const values = exth.get(type) ?? [];
    values.push(record.subarray(at + 8, at + length));
    exth.set(type, values);
    at += length;
  }
  return exth;
}

/** Reads the headers of a book's record 0 (or of the KF8 part's first record in a joint file). */
export function readMobiHeader(record: Buffer): MobiHeader {
  if (record.subarray(MOBI_HEADER_START, MOBI_HEADER_START + 4).toString('latin1') !== 'MOBI') {
    throw corrupt(new Error('record 0 has no MOBI header'));
  }
  const headerLength = record.readUInt32BE(20);
  const exthFlags = record.readUInt32BE(128);
  const nameOffset = record.readUInt32BE(84);
  const nameLength = record.readUInt32BE(88);
  const version = record.readUInt32BE(36);
  const encoding = record.readUInt32BE(28);
  return {
    compression: record.readUInt16BE(0),
    textLength: record.readUInt32BE(4),
    textRecordCount: record.readUInt16BE(8),
    encryption: record.readUInt16BE(12),
    encoding,
    version,
    fullName: decodeMobiText(record.subarray(nameOffset, nameOffset + nameLength), encoding),
    firstImageIndex: record.readUInt32BE(108),
    extraFlags: headerLength >= EXTRA_FLAGS_MIN_HEADER ? record.readUInt16BE(242) : 0,
    // Only KF8 headers have an FDST index here; MOBI6 keeps content record numbers in the same bytes.
    fdstIndex: version >= 8 ? record.readUInt32BE(192) : NO_RECORD,
    exth: (exthFlags & EXTH_FLAG) !== 0 ? readExth(record, MOBI_HEADER_START + headerLength) : new Map(),
  };
}

/** MOBI text is UTF-8 (65001) or, in older files, Windows-1252 (1252). */
export function decodeMobiText(bytes: Buffer, encoding: number): string {
  return new TextDecoder(encoding === UTF8_CODE_PAGE ? 'utf-8' : 'windows-1252').decode(bytes);
}

export function exthNumber(header: MobiHeader, type: number): number | null {
  const value = header.exth.get(type)?.[0];
  return value !== undefined && value.length >= 4 ? value.readUInt32BE(0) : null;
}
