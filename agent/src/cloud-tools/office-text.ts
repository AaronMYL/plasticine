import { openZip, type ZipArchive } from '../util/index.ts';

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

export const OFFICE_TYPES: Readonly<Record<string, OfficeKind>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const PARTS_MAX = 200;
const COLUMNS_MAX = 16_384;

function entryText(zip: ZipArchive, name: string): string | null {
  return zip.read(name)?.toString('utf8') ?? null;
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

function textsOf(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? '')).join('');
}

function numbered(zip: ZipArchive, pattern: RegExp): string[] {
  return zip.names().filter((name) => pattern.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0))
    .slice(0, PARTS_MAX);
}

function docxText(zip: ZipArchive): string | null {
  const xml = entryText(zip, 'word/document.xml');
  if (xml === null) return null;
  return [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((match) => textsOf(match[0]
    .replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>'), 'w:t'))
    .filter((line) => line.trim() !== '').join('\n');
}

export interface SheetRows {
  name: string;
  rows: string[][];
}

function columnOf(attrs: string): number | null {
  const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
  if (ref === undefined) return null;
  return [...ref].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function sheetRows(xml: string, shared: readonly string[]): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const inner = cell[2] ?? '';
      let value = textsOf(inner, 'v');
      if (/\bt="s"/.test(attrs)) value = shared[Number(value)] ?? '';
      else if (/\bt="inlineStr"/.test(attrs)) value = textsOf(inner, 't');
      const column = Math.min(columnOf(attrs) ?? cells.length, COLUMNS_MAX);
      while (cells.length < column) cells.push('');
      cells[column] = value;
    }
    while (cells.length > 0 && cells.at(-1) === '') cells.pop();
    return cells;
  });
}

function xlsxSheetsOf(zip: ZipArchive): SheetRows[] | null {
  const sharedXml = entryText(zip, 'xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textsOf(match[1] ?? '', 't'));
  const book = entryText(zip, 'xl/workbook.xml') ?? '';
  const names = [...book.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1] ?? ''));
  const sheets = numbered(zip, /^xl\/worksheets\/sheet\d+\.xml$/);
  if (sheets.length === 0) return null;
  return sheets.map((name, index) => {
    const xml = entryText(zip, name) ?? '';
    return { name: names[index] ?? `表 ${index + 1}`, rows: sheetRows(xml, shared) };
  });
}

function xlsxText(zip: ZipArchive): string | null {
  const sheets = xlsxSheetsOf(zip);
  if (sheets === null) return null;
  return sheets.map((sheet) => [`## ${sheet.name}`, ...sheet.rows.map((cells) => cells.join('\t'))
    .filter((line) => line !== '')].join('\n')).join('\n\n');
}

function pptxText(zip: ZipArchive): string | null {
  const slides = numbered(zip, /^ppt\/slides\/slide\d+\.xml$/);
  if (slides.length === 0) return null;
  return slides.map((name, index) => {
    const xml = entryText(zip, name) ?? '';
    const lines = [...xml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)].map((match) => textsOf(match[0], 'a:t'))
      .filter((line) => line.trim() !== '');
    return [`## 第 ${index + 1} 页`, ...lines].join('\n');
  }).join('\n\n');
}

export function xlsxSheets(data: Buffer): SheetRows[] | null {
  const zip = openZip(data);
  return zip === null ? null : xlsxSheetsOf(zip);
}

export function officeText(kind: OfficeKind, data: Buffer): string | null {
  const zip = openZip(data);
  if (zip === null) return null;
  if (kind === 'docx') return docxText(zip);
  if (kind === 'xlsx') return xlsxText(zip);
  return pptxText(zip);
}
