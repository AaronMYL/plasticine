// 在界面这一头打一个 zip（资料库导出网页、PDF、长图时，多篇装一个包）：只存不压（PDF、PNG 本来就压过），文件名
// UTF-8。不加新包。

const LOCAL_ENTRY = 0x04034b50;
const CENTRAL_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const VERSION = 20;
const FLAG_UTF8 = 0x0800;
// 1980-01-01 00:00：内容一样包就一样。
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table !== null) return table;
  table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array): number {
  const lookup = crcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = (lookup[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface StoredFile {
  name: string;
  data: Uint8Array;
}

function header(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

export function zipStore(files: readonly StoredFile[]): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    parts.push(header(30, (view) => {
      view.setUint32(0, LOCAL_ENTRY, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, FLAG_UTF8, true);
      view.setUint16(12, DOS_DATE, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, size, true);
      view.setUint32(22, size, true);
      view.setUint16(26, name.length, true);
    }), name, file.data);
    central.push(header(46, (view) => {
      view.setUint32(0, CENTRAL_ENTRY, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, VERSION, true);
      view.setUint16(8, FLAG_UTF8, true);
      view.setUint16(14, DOS_DATE, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, size, true);
      view.setUint32(24, size, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
    }), name);
    offset += 30 + name.length + size;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, (view) => {
    view.setUint32(0, END_OF_DIRECTORY, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, offset, true);
  });
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' });
}
