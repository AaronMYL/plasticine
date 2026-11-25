import { cellValue, parseCsv, writeCsv } from './csv.ts';
import { blocksHtml } from './blocks-html.ts';
import { makeDocx } from './docx-make.ts';
import { type Block, type Inline, markdownBlocks, plainOf } from './markdown-blocks.ts';
import { type Cell, type ImageData, xmlEscape } from './package-xml.ts';
import { makeXlsx, type SheetInput } from './xlsx-make.ts';

export interface ConvertPorts {
  printPdf(html: string, signal: AbortSignal): Promise<Buffer>;
  officeText(kind: 'docx' | 'xlsx' | 'pptx', data: Buffer): string | null;
  xlsxSheets(data: Buffer): { name: string; rows: string[][] }[] | null;
  pdfText(name: string, data: Buffer, signal: AbortSignal): Promise<string>;
  convertMedia(input: { data: Buffer; extension: string }, output: string, signal: AbortSignal, quality?: number):
    Promise<Buffer>;
}

export type Source =
  | { kind: 'document'; blocks: Block[]; text: string }
  | { kind: 'table'; sheets: SheetInput[] }
  | { kind: 'image'; data: Buffer; extension: string }
  | { kind: 'media'; data: Buffer; extension: string };

const DOCUMENT_IN = ['md', 'txt', 'log', 'docx', 'pptx', 'pdf'];
const TABLE_IN = ['xlsx', 'csv', 'tsv'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
export const MEDIA_EXTENSIONS = ['mp3', 'm4a', 'wav', 'mp4', 'mov'];
const AUDIO_OUT = ['mp3', 'm4a', 'wav'];
export const DOCUMENT_TABLE_ROWS_MAX = 2_000;
const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export class ConvertError extends Error {}

function textDocument(text: string): Source {
  const blocks: Block[] = text.split(/\r?\n/).filter((line) => line.trim() !== '')
    .map((line) => ({ kind: 'paragraph', inline: [{ text: line }] }));
  return { kind: 'document', blocks, text };
}

function tableOf(name: string, rows: readonly (readonly string[])[]): SheetInput {
  return { name, rows: rows.map((row) => row.map(cellValue)) };
}

export async function readSource(name: string, extension: string, data: Buffer, ports: ConvertPorts,
  signal: AbortSignal): Promise<Source> {
  if (IMAGE_EXTENSIONS.includes(extension)) {
    return { kind: 'image', data, extension };
  }
  if (MEDIA_EXTENSIONS.includes(extension)) {
    return { kind: 'media', data, extension };
  }
  if (extension === 'md') {
    const text = data.toString('utf8');
    return { kind: 'document', blocks: markdownBlocks(text), text };
  }
  if (extension === 'txt' || extension === 'log') {
    return textDocument(data.toString('utf8'));
  }
  if (extension === 'pdf') {
    return textDocument(await ports.pdfText(name, data, signal));
  }
  if (extension === 'csv' || extension === 'tsv') {
    const rows = parseCsv(data.toString('utf8'), extension === 'csv' ? ',' : '\t');
    return { kind: 'table', sheets: [tableOf(name.replace(/\.[^.]+$/, ''), rows)] };
  }
  if (extension === 'xlsx') {
    const sheets = ports.xlsxSheets(data);
    if (sheets === null) {
      throw new ConvertError('这份 .xlsx 读不出来（不是正常的文件，或者加了密）。');
    }
    return { kind: 'table', sheets: sheets.map((sheet) => tableOf(sheet.name, sheet.rows)) };
  }
  if (extension === 'docx' || extension === 'pptx') {
    const text = ports.officeText(extension, data);
    if (text === null) {
      throw new ConvertError(`这份 .${extension} 读不出来（不是正常的文件，或者加了密）。`);
    }
    return extension === 'pptx' ? { kind: 'document', blocks: markdownBlocks(text), text } : textDocument(text);
  }
  const known = [...DOCUMENT_IN, ...TABLE_IN, ...IMAGE_EXTENSIONS, ...MEDIA_EXTENSIONS].join('、');
  throw new ConvertError(`.${extension} 的文件转不了；能转的来源：${known}。`);
}

function cellText(value: Cell): string {
  return value === null ? '' : String(value);
}

export function tableBlocks(sheets: readonly SheetInput[]): Block[] {
  return sheets.flatMap((sheet): Block[] => {
    const [head = [], ...rest] = sheet.rows;
    const width = Math.max(head.length, ...rest.map((row) => row.length), 1);
    const cells = (row: readonly Cell[]) => Array.from({ length: width },
      (_, index) => [{ text: cellText(row[index] ?? null) }]);
    const title: Block[] = sheets.length > 1 ? [{ kind: 'heading', level: 2, inline: [{ text: sheet.name }] }] : [];
    const rows = rest.slice(0, DOCUMENT_TABLE_ROWS_MAX).map(cells);
    const more: Block[] = rest.length > DOCUMENT_TABLE_ROWS_MAX
      ? [{ kind: 'paragraph', inline: [{ text: `（还有 ${rest.length - DOCUMENT_TABLE_ROWS_MAX} 行没放进来）` }] }] : [];
    return [...title, { kind: 'table', head: cells(head), rows }, ...more];
  });
}

export function blocksMarkdown(blocks: readonly Block[]): string {
  const row = (cells: readonly Inline[][]) =>
    `| ${cells.map((cell) => plainOf(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`;
  return blocks.map((block) => {
    switch (block.kind) {
      case 'heading':
        return `${'#'.repeat(block.level)} ${plainOf(block.inline)}`;
      case 'paragraph':
        return plainOf(block.inline);
      case 'quote':
        return `> ${plainOf(block.inline)}`;
      case 'code':
        return `\`\`\`\n${block.text}\n\`\`\``;
      case 'rule':
        return '---';
      case 'image':
        return `![${block.alt}](${block.src})`;
      case 'list':
        return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${plainOf(item)}`).join('\n');
      case 'table':
        return [row(block.head), `|${block.head.map(() => ' --- ').join('|')}|`, ...block.rows.map(row)].join('\n');
    }
  }).join('\n\n');
}

function plainText(blocks: readonly Block[]): string {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'code':
        return block.text;
      case 'rule':
        return '';
      case 'image':
        return block.alt;
      case 'list':
        return block.items.map((item) => plainOf(item)).join('\n');
      case 'table':
        return [block.head, ...block.rows].map((cells) => cells.map(plainOf).join('\t')).join('\n');
      default:
        return plainOf(block.inline);
    }
  }).filter((text) => text !== '').join('\n\n');
}

function pickSheet(sheets: readonly SheetInput[], sheet: string | undefined): SheetInput {
  if (sheet === undefined) {
    return sheets[0] ?? { name: '表1', rows: [] };
  }
  const found = sheets.find((item) => item.name === sheet);
  if (found === undefined) {
    throw new ConvertError(`没有叫「${sheet}」的表；有：${sheets.map((item) => item.name).join('、')}。`);
  }
  return found;
}

function imagePage(source: { data: Buffer; extension: string }, title: string): string {
  const mime = IMAGE_MIME[source.extension] ?? 'image/png';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${xmlEscape(title)}</title><style>`
    + '@page { size: A4; margin: 10mm; } body { margin: 0; } '
    + 'img { display: block; max-width: 100%; max-height: 277mm; margin: 0 auto; object-fit: contain; }</style></head>'
    + `<body><img src="data:${mime};base64,${source.data.toString('base64')}"></body></html>`;
}

export interface WriteOptions {
  title: string;
  image: (src: string) => ImageData | null;
  sheet?: string;
  quality?: number;
}

async function writeDocument(blocks: readonly Block[], text: string, to: string, ports: ConvertPorts,
  options: WriteOptions, signal: AbortSignal): Promise<Buffer> {
  switch (to) {
    case 'docx':
      return makeDocx(blocks, options.image);
    case 'pdf':
      return ports.printPdf(blocksHtml(blocks, options.title, options.image), signal);
    case 'md':
      return Buffer.from(text === '' ? blocksMarkdown(blocks) : text, 'utf8');
    case 'txt':
      return Buffer.from(plainText(blocks), 'utf8');
    default:
      throw new ConvertError(`文档转不成 .${to}：能转成 docx、pdf、md、txt。`);
  }
}

export async function writeAs(source: Source, to: string, ports: ConvertPorts, options: WriteOptions,
  signal: AbortSignal): Promise<Buffer> {
  if (source.kind === 'document') {
    return writeDocument(source.blocks, to === 'md' ? source.text : '', to, ports, options, signal);
  }
  if (source.kind === 'table') {
    if (to === 'xlsx') {
      return makeXlsx(source.sheets);
    }
    if (to === 'csv' || to === 'tsv') {
      return Buffer.from(writeCsv(pickSheet(source.sheets, options.sheet).rows, to === 'csv' ? ',' : '\t'), 'utf8');
    }
    const sheets = options.sheet === undefined ? source.sheets : [pickSheet(source.sheets, options.sheet)];
    return writeDocument(tableBlocks(sheets), '', to, ports, options, signal);
  }
  if (source.kind === 'image') {
    if (to === 'pdf') {
      return ports.printPdf(imagePage(source, options.title), signal);
    }
    if (IMAGE_EXTENSIONS.includes(to)) {
      return ports.convertMedia(source, to, signal, options.quality);
    }
    throw new ConvertError(`图片转不成 .${to}：能转成 png、jpg、webp、gif、pdf。`);
  }
  const fromVideo = source.extension === 'mp4' || source.extension === 'mov';
  if (AUDIO_OUT.includes(to) || (fromVideo && MEDIA_EXTENSIONS.includes(to))) {
    return ports.convertMedia(source, to, signal);
  }
  throw new ConvertError(`.${source.extension} 转不成 .${to}：音频能转 mp3、m4a、wav，视频还能转 mp4、mov。`);
}
