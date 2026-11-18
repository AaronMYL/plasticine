// Word（.docx）读成一串块（导入资料库，11-18）：只读 word/document.xml 正文里一段段和一张张表，按样式认标题（标题、
// 标题 1–3，也认大纲级别）、引用、代码；编号段落连成列表（按编号格式分有序、无序）；行内的粗体、斜体、超链接；
// 图（a:blip）交给调用的一方存成 Plasticine 的资产。读不了（不是 zip、没有正文）是 null。

import { attribute, findAll, parseHtml, type HtmlElement, type HtmlNode } from '../../shared/space-html.ts';
import type { Block, Inline } from '../artifacts/index.ts';
import { openZip, type ZipArchive } from '../util/index.ts';

/** 存一张图：给回能放进空间的地址；存不了（格式不认）是 null。 */
export type SaveImage = (data: Buffer, name: string) => string | null;

interface DocxContext {
  zip: ZipArchive;
  /** 样式标识 → 样式名（小写）。 */
  styles: Map<string, string>;
  /** 编号标识 → 是不是有序。 */
  ordered: Map<string, boolean>;
  /** 关系标识 → 目标（图的路径、超链接的地址）。 */
  rels: Map<string, string>;
  saveImage: SaveImage;
}

type Paragraph =
  | { kind: 'block'; block: Block }
  | { kind: 'item'; ordered: boolean; inline: Inline[] };

function children(element: HtmlElement, name?: string): HtmlElement[] {
  return element.children.filter((child): child is HtmlElement => child.kind === 'element'
    && (name === undefined || child.name === name));
}

function xmlOf(zip: ZipArchive, name: string): HtmlElement | null {
  const data = zip.read(name);
  return data === null ? null : parseHtml(data.toString('utf8'));
}

function stylesOf(zip: ZipArchive): Map<string, string> {
  const styles = new Map<string, string>();
  const root = xmlOf(zip, 'word/styles.xml');
  for (const style of root === null ? [] : findAll(root, (element) => element.name === 'w:style')) {
    const id = attribute(style, 'w:styleid');
    const name = children(style, 'w:name')[0];
    if (id !== null) styles.set(id, (name === undefined ? id : attribute(name, 'w:val') ?? id).toLowerCase());
  }
  return styles;
}

function numberingOf(zip: ZipArchive): Map<string, boolean> {
  const root = xmlOf(zip, 'word/numbering.xml');
  if (root === null) return new Map();
  const abstracts = new Map<string, boolean>();
  for (const abstract of findAll(root, (element) => element.name === 'w:abstractnum')) {
    const format = findAll(abstract, (element) => element.name === 'w:numfmt')[0];
    abstracts.set(attribute(abstract, 'w:abstractnumid') ?? '', attribute(format ?? abstract, 'w:val') !== 'bullet'
      && format !== undefined);
  }
  const ordered = new Map<string, boolean>();
  for (const num of findAll(root, (element) => element.name === 'w:num')) {
    const abstract = children(num, 'w:abstractnumid')[0];
    ordered.set(attribute(num, 'w:numid') ?? '', abstracts.get(abstract === undefined ? ''
      : attribute(abstract, 'w:val') ?? '') ?? false);
  }
  return ordered;
}

function relsOf(zip: ZipArchive): Map<string, string> {
  const root = xmlOf(zip, 'word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  for (const rel of root === null ? [] : findAll(root, (element) => element.name === 'relationship')) {
    rels.set(attribute(rel, 'id') ?? '', attribute(rel, 'target') ?? '');
  }
  return rels;
}

/** 开关类的属性（w:b、w:i）：写了就算开，除非 w:val 是 0 / false / none。 */
function switchedOn(properties: HtmlElement | undefined, name: string): boolean {
  const found = properties === undefined ? undefined : children(properties, name)[0];
  if (found === undefined) return false;
  const value = attribute(found, 'w:val');
  return value === null || !['0', 'false', 'none'].includes(value.toLowerCase());
}

function runText(run: HtmlElement): string {
  return run.children.map((child: HtmlNode) => {
    if (child.kind !== 'element') return '';
    if (child.name === 'w:t') return child.children.map((text) => (text.kind === 'text' ? text.text : '')).join('');
    if (child.name === 'w:tab') return '\t';
    if (child.name === 'w:br' || child.name === 'w:cr') return ' ';
    return '';
  }).join('');
}

interface ParagraphParts {
  inline: Inline[];
  images: Block[];
}

function collect(element: HtmlElement, context: DocxContext, link: string | undefined, out: ParagraphParts): void {
  for (const child of children(element)) {
    if (child.name === 'w:r') {
      const properties = children(child, 'w:rpr')[0];
      const text = runText(child);
      if (text !== '') {
        out.inline.push({ text, ...(switchedOn(properties, 'w:b') ? { bold: true } : {}),
          ...(switchedOn(properties, 'w:i') ? { italic: true } : {}), ...(link === undefined ? {} : { link }) });
      }
      for (const blip of findAll(child, (element) => element.name === 'a:blip')) {
        const target = context.rels.get(attribute(blip, 'r:embed') ?? '') ?? '';
        const data = target === '' ? null : context.zip.read(`word/${target.replace(/^\/?word\//, '')}`);
        const described = findAll(child, (element) => element.name === 'wp:docpr')[0];
        const alt = described === undefined ? '' : attribute(described, 'descr') ?? '';
        const src = data === null ? null : context.saveImage(data, target);
        out.images.push(src === null ? { kind: 'paragraph', inline: [{ text: `图片没带进来：${target}` }] }
          : { kind: 'image', src, alt });
      }
    } else if (child.name === 'w:hyperlink') {
      const target = context.rels.get(attribute(child, 'r:id') ?? '');
      collect(child, context, target !== undefined && /^(https?:|mailto:)/i.test(target) ? target : link, out);
    } else if (child.name === 'w:smarttag' || child.name === 'w:ins' || child.name === 'w:sdt'
      || child.name === 'w:sdtcontent' || child.name === 'w:fldsimple') {
      collect(child, context, link, out);
    }
  }
}

function merge(parts: readonly Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last !== undefined && last.bold === part.bold && last.italic === part.italic && last.link === part.link) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged.filter((part) => part.text !== '');
}

function headingLevel(style: string, outline: string | null): 1 | 2 | 3 | null {
  if (style === 'title') return 1;
  const named = /^(?:heading|标题)\s*(\d)$/.exec(style)?.[1];
  const level = named !== undefined ? Number(named) : outline === null ? NaN : Number(outline) + 1;
  return Number.isFinite(level) && level >= 1 && level <= 9 ? Math.min(3, level) as 1 | 2 | 3 : null;
}

function paragraphOf(paragraph: HtmlElement, context: DocxContext): Paragraph[] {
  const properties = children(paragraph, 'w:ppr')[0];
  const styleRef = properties === undefined ? undefined : children(properties, 'w:pstyle')[0];
  const styleId = styleRef === undefined ? '' : attribute(styleRef, 'w:val') ?? '';
  const style = context.styles.get(styleId) ?? styleId.toLowerCase();
  const outline = properties === undefined ? undefined : children(properties, 'w:outlinelvl')[0];
  const numbering = properties === undefined ? undefined : children(properties, 'w:numpr')[0];
  const numId = numbering === undefined ? undefined : children(numbering, 'w:numid')[0];
  const parts: ParagraphParts = { inline: [], images: [] };
  collect(paragraph, context, undefined, parts);
  const inline = merge(parts.inline);
  const text = inline.map((part) => part.text).join('');
  const images = parts.images.map((block): Paragraph => ({ kind: 'block', block }));
  if (text.trim() === '') {
    const ruled = properties !== undefined && findAll(properties, (element) => element.name === 'w:bottom').length > 0;
    return ruled && images.length === 0 ? [{ kind: 'block', block: { kind: 'rule' } }] : images;
  }
  const level = headingLevel(style, outline === undefined ? null : attribute(outline, 'w:val'));
  let first: Paragraph;
  if (level !== null) first = { kind: 'block', block: { kind: 'heading', level, inline } };
  else if (style === 'code' || style === 'html preformatted') first = { kind: 'block', block: { kind: 'code', text } };
  else if (style.includes('quote')) first = { kind: 'block', block: { kind: 'quote', inline } };
  else if (numId !== undefined) {
    first = { kind: 'item', ordered: context.ordered.get(attribute(numId, 'w:val') ?? '') ?? false, inline };
  } else first = { kind: 'block', block: { kind: 'paragraph', inline } };
  return [first, ...images];
}

/** 表格里的粗体不留：表头本来就加粗，留着读回来每格都是粗的。 */
function tableOf(table: HtmlElement, context: DocxContext): Block | null {
  const rows = children(table, 'w:tr').map((row) => children(row, 'w:tc').map((cell) =>
    merge(children(cell, 'w:p').flatMap((paragraph, index) => {
      const parts: ParagraphParts = { inline: [], images: [] };
      collect(paragraph, context, undefined, parts);
      return index === 0 ? parts.inline : [{ text: ' ' }, ...parts.inline];
    })).map(({ bold: _bold, ...rest }) => rest)));
  const [head, ...rest] = rows;
  return head === undefined ? null : { kind: 'table', head, rows: rest };
}

/** 相邻的代码段落、列表项并起来。 */
function assemble(paragraphs: readonly Paragraph[]): Block[] {
  const blocks: Block[] = [];
  for (const paragraph of paragraphs) {
    const last = blocks.at(-1);
    if (paragraph.kind === 'item') {
      if (last?.kind === 'list' && last.ordered === paragraph.ordered) last.items.push(paragraph.inline);
      else blocks.push({ kind: 'list', ordered: paragraph.ordered, items: [paragraph.inline] });
    } else if (paragraph.block.kind === 'code' && last?.kind === 'code') {
      last.text = `${last.text}\n${paragraph.block.text}`;
    } else {
      blocks.push(paragraph.block);
    }
  }
  return blocks;
}

export function docxBlocks(data: Buffer, saveImage: SaveImage): Block[] | null {
  const zip = openZip(data);
  const document = zip === null ? null : xmlOf(zip, 'word/document.xml');
  const body = document === null ? undefined : findAll(document, (element) => element.name === 'w:body')[0];
  if (zip === null || body === undefined) return null;
  const context: DocxContext = { zip, styles: stylesOf(zip), ordered: numberingOf(zip), rels: relsOf(zip), saveImage };
  const paragraphs: Paragraph[] = [];
  for (const child of children(body)) {
    if (child.name === 'w:p') paragraphs.push(...paragraphOf(child, context));
    else if (child.name === 'w:tbl') {
      const table = tableOf(child, context);
      if (table !== null) paragraphs.push({ kind: 'block', block: table });
    } else if (child.name === 'w:sdt') {
      for (const inner of findAll(child, (element) => element.name === 'w:p')) {
        paragraphs.push(...paragraphOf(inner, context));
      }
    }
  }
  return assemble(paragraphs);
}
