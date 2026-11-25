export type Cell = string | number | boolean | null;

export interface ImageData {
  data: Buffer;
  type: 'png' | 'jpeg';
  width: number;
  height: number;
}

export interface Relation {
  id: string;
  type: string;
  target: string;
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const EMU_PER_PX = 9525;

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function xmlEscape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

function jpegSize(data: Buffer): ImageData | null {
  for (let at = 2; at + 9 < data.length;) {
    if (data[at] !== 0xff) {
      return null;
    }
    const marker = data[at + 1] ?? 0;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      return { data, type: 'jpeg', height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
    }
    at += 2 + data.readUInt16BE(at + 2);
  }
  return null;
}

export function imageInfo(data: Buffer): ImageData | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { data, type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    return jpegSize(data);
  }
  return null;
}

function webpSize(data: Buffer): { width: number; height: number } | null {
  const chunk = data.toString('latin1', 12, 16);
  if (chunk === 'VP8X' && data.length >= 30) {
    return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L' && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && data.length >= 30) {
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function pixelSize(data: Buffer): { width: number; height: number } | null {
  if (data.length > 16 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    return webpSize(data);
  }
  const image = imageInfo(data);
  return image === null ? null : { width: image.width, height: image.height };
}

export function relsXml(rels: readonly Relation[]): string {
  const items = rels.map((rel) =>
    `<Relationship Id="${rel.id}" Type="${OFFICE_REL}/${rel.type}" Target="${rel.target}"/>`);
  return `${XML_HEAD}<Relationships xmlns="${REL_NS}">${items.join('')}</Relationships>`;
}

export function packageRels(target: string): string {
  return relsXml([{ id: 'rId1', type: 'officeDocument', target }]);
}

export function contentTypes(overrides: readonly (readonly [string, string])[]): string {
  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
  ].map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`);
  const parts = overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`);
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `${defaults.join('')}${parts.join('')}</Types>`;
}
