import { Type } from 'typebox';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import { ArtifactError } from './errors.ts';
import { saveFile } from './file-tools.ts';
import { extensionOf } from './file-types.ts';
import { blocksHtml } from './office/blocks-html.ts';
import { ConvertError, type ConvertPorts, readSource, writeAs } from './office/convert.ts';
import { writeCsv } from './office/csv.ts';
import { makeDocx } from './office/docx-make.ts';
import { markdownBlocks } from './office/markdown-blocks.ts';
import { type ImageData, imageInfo } from './office/package-xml.ts';
import { makePptx } from './office/pptx-make.ts';
import { makeXlsx } from './office/xlsx-make.ts';
import { pathSegments, type Workspace } from './workspace.ts';

export interface OfficeToolParts extends ConvertPorts {
  workspace: Workspace;
}

const MARKDOWN_MAX_CHARS = 2_000_000;
const CELLS_MAX = 1_000_000;
const SLIDES_MAX = 100;
const MAKE_TYPES = ['docx', 'pdf', 'md', 'xlsx', 'csv', 'tsv', 'pptx'];

const CellSchema = Type.Union([Type.String({ maxLength: 32_767 }), Type.Number(), Type.Boolean(), Type.Null()]);
const SheetSchema = Type.Object({
  name: Type.String({ maxLength: 100 }),
  rows: Type.Array(Type.Array(CellSchema, { maxItems: 16_384 }), { maxItems: 1_048_576,
    description: '一行一个数组；第一行当表头。数字给数字；「=」开头的字是公式（如 "=SUM(B2:B9)"）。' }),
}, { additionalProperties: false });
const SlideSchema = Type.Object({
  title: Type.String({ maxLength: 200 }),
  bullets: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 20 })),
  image: Type.Optional(Type.String({ maxLength: 1_000, description: '文件页里一张 png 或 jpg 的路径，放在右半边。' })),
}, { additionalProperties: false });

const MakeParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 1_000,
    description: '存到文件页的哪里，扩展名决定格式：.docx、.pdf、.md 用 markdown；.xlsx、.csv、.tsv 用 sheets；'
      + '.pptx 用 slides。' }),
  markdown: Type.Optional(Type.String({ maxLength: MARKDOWN_MAX_CHARS,
    description: '正文：标题、段落、列表、引用、代码、表格、分隔线；图写 ![说明](文件页里的路径)，只认 png、jpg。' })),
  sheets: Type.Optional(Type.Array(SheetSchema, { minItems: 1, maxItems: 50,
    description: 'Excel 的几张表（CSV、TSV 只用第一张）。' })),
  slides: Type.Optional(Type.Array(SlideSchema, { minItems: 1, maxItems: SLIDES_MAX })),
  title: Type.Optional(Type.String({ maxLength: 200, description: 'PDF 的标题（不给用文件名）。' })),
  overwrite: Type.Optional(Type.Boolean({ description: '已有同名文件时换掉它（旧的进最近删除，能还原）。' })),
}, { additionalProperties: false });

const ConvertParameters = Type.Object({
  from: Type.String({ minLength: 1, maxLength: 1_000, description: '文件页里要转的那个文件。' }),
  to: Type.String({ minLength: 1, maxLength: 1_000, description: '转出来存到哪里，扩展名决定格式。' }),
  sheet: Type.Optional(Type.String({ maxLength: 100, description: 'Excel 转 CSV 等只要一张表时，要哪张（默认第一张）。' })),
  quality: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: '转 jpg、webp 时的质量，默认 85。' })),
  overwrite: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

function folderOf(path: string): string {
  return pathSegments(path).slice(0, -1).join('/');
}

function imageFinder(workspace: Workspace, outputPath: string): (src: string) => ImageData | null {
  return (src) => {
    if (/^[a-z]+:/i.test(src)) {
      return null;
    }
    const folder = folderOf(outputPath);
    for (const candidate of [src, folder === '' ? src : `${folder}/${src}`]) {
      try {
        return imageInfo(workspace.read(candidate).data);
      } catch (cause) {
        if (!(cause instanceof ArtifactError)) throw cause;
      }
    }
    return null;
  };
}

function titleOf(path: string, title: string | undefined): string {
  return title ?? (pathSegments(path).at(-1) ?? '文件').replace(/\.[^.]+$/, '');
}

function slideImage(workspace: Workspace, path: string | undefined): Buffer | undefined {
  if (path === undefined) {
    return undefined;
  }
  const { data } = workspace.read(path);
  if (imageInfo(data) === null) {
    throw new ArtifactError('unsupported_type', `「${path}」不是 png 或 jpg，放不进幻灯片：先用 file_convert 转成 png。`);
  }
  return data;
}

async function made(parts: OfficeToolParts, args: ReturnType<typeof checkedArgs<typeof MakeParameters>>,
  signal: AbortSignal): Promise<Buffer> {
  const type = extensionOf(args.path);
  if (!MAKE_TYPES.includes(type)) {
    throw new ArtifactError('unsupported_type', `生成不了 .${type || '（没有扩展名）'}；能生成：${MAKE_TYPES.join('、')}。`);
  }
  if (type === 'pptx') {
    if (args.slides === undefined) throw new ArtifactError('invalid_input', '.pptx 要给 slides。', 'slides');
    return makePptx(args.slides.map((slide) => {
      const image = slideImage(parts.workspace, slide.image);
      return { title: slide.title, bullets: slide.bullets ?? [], ...(image === undefined ? {} : { image }) };
    }));
  }
  if (type === 'xlsx' || type === 'csv' || type === 'tsv') {
    if (args.sheets === undefined) throw new ArtifactError('invalid_input', `.${type} 要给 sheets。`, 'sheets');
    const cells = args.sheets.reduce((sum, sheet) => sum + sheet.rows.reduce((n, row) => n + row.length, 0), 0);
    if (cells > CELLS_MAX) {
      throw new ArtifactError('invalid_input', `一次最多 ${CELLS_MAX} 个格子：分几张表或几次写。`, 'sheets');
    }
    return type === 'xlsx' ? makeXlsx(args.sheets)
      : Buffer.from(writeCsv(args.sheets[0]?.rows ?? [], type === 'csv' ? ',' : '\t'), 'utf8');
  }
  if (args.markdown === undefined) throw new ArtifactError('invalid_input', `.${type} 要给 markdown。`, 'markdown');
  if (type === 'md') return Buffer.from(args.markdown, 'utf8');
  const blocks = markdownBlocks(args.markdown);
  const image = imageFinder(parts.workspace, args.path);
  return type === 'docx' ? makeDocx(blocks, image)
    : parts.printPdf(blocksHtml(blocks, titleOf(args.path, args.title), image), signal);
}

async function converted(parts: OfficeToolParts, args: ReturnType<typeof checkedArgs<typeof ConvertParameters>>,
  signal: AbortSignal): Promise<Buffer> {
  const { data, entry } = parts.workspace.read(args.from);
  const to = extensionOf(args.to);
  try {
    const source = await readSource(entry.name, extensionOf(entry.name), data, parts, signal);
    const options = { title: titleOf(args.to, undefined), image: imageFinder(parts.workspace, args.from),
      ...(args.sheet === undefined ? {} : { sheet: args.sheet }),
      ...(args.quality === undefined ? {} : { quality: args.quality }) };
    return await writeAs(source, to, parts, options, signal);
  } catch (cause) {
    if (cause instanceof ConvertError) throw new ArtifactError('unsupported_type', cause.message, 'to');
    throw cause;
  }
}

export function officeTools(parts: OfficeToolParts): KernelTool[] {
  const make: KernelTool = {
    name: 'file_make',
    say: (args) => (typeof args['path'] === 'string' ? `生成文件：${args['path']}` : '生成文件'),
    hardLine: () => null,
    create: () => ({
      name: 'file_make', label: '生成文件',
      description: '生成一个 Word、PDF、Excel、CSV 或 PowerPoint 文件存进文件页：文档给 markdown，表格给 sheets，'
        + '幻灯片给 slides（每页标题、几条要点、可带一张图）。要发给他再用 reply_files。',
      parameters: MakeParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(MakeParameters, input, 'file_make');
        const data = await made(parts, args, signal ?? new AbortController().signal);
        const { entry, replaced } = saveFile(parts.workspace, args.path, data, args.overwrite ?? false);
        return result({ path: entry.path, bytes: entry.bytes,
          ...(replaced ? { note: '旧的那份在文件页的最近删除里，能还原。' } : {}) });
      },
    }),
  };
  const convert: KernelTool = {
    name: 'file_convert',
    say: (args) => (typeof args['to'] === 'string' ? `转格式：${args['to']}` : '转格式'),
    hardLine: () => null,
    create: () => ({
      name: 'file_convert', label: '转格式',
      description: '把文件页里的一个文件转成另一种格式另存一份（原文件不动）。文档：md、txt、docx、pptx、pdf → docx、'
        + 'pdf、md、txt（Word、PPT、PDF 只取文字，版式会变）；表格：xlsx、csv、tsv → xlsx、csv、tsv、md、docx、pdf；'
        + '图片：png、jpg、webp、gif 互转，或转 pdf；音视频：转 mp3、m4a、wav，视频之间 mp4、mov。',
      parameters: ConvertParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(ConvertParameters, input, 'file_convert');
        const data = await converted(parts, args, signal ?? new AbortController().signal);
        const { entry, replaced } = saveFile(parts.workspace, args.to, data, args.overwrite ?? false);
        return result({ path: entry.path, bytes: entry.bytes,
          ...(replaced ? { note: '旧的那份在文件页的最近删除里，能还原。' } : {}) });
      },
    }),
  };
  return [make, convert];
}
