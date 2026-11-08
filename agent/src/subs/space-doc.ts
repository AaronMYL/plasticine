// 空间正文的核对（第 6 条，11-06 定）：图表只能用存下来的数据画、要写来源；图片要写来源；正文里 [^n] 要有对应出处。
// 写之前都过这里：schema 之外再查 schema 写不出来的几条（数据个数对得上、数是有限数、锚点不重复）。

import { Value } from 'typebox/value';
import { SpaceDocSchema, SPACE_TEXT_MAX_CHARS, type SpaceBlock, type SpaceDoc } from '../../shared/state.ts';
import { SubsError } from './errors.ts';

const FOOTNOTE = /\[\^(\d+)\]/g;
const BLOCKS_MAX = 400;
const HEADING_MAX = 200;

function schemaMessage(doc: unknown): string {
  const first = Value.Errors(SpaceDocSchema, doc)[0];
  if (first === undefined) {
    return '空间正文的格式不对。';
  }
  const where = first.instancePath === '' ? '正文' : first.instancePath;
  return `空间正文的格式不对：${where} ${first.message}。图表和图片都要写来源（source.label）。`;
}

function checkChart(block: Extract<SpaceBlock, { type: 'chart' }>, index: number): void {
  for (const series of block.series) {
    if (series.values.length !== block.x.length) {
      throw new SubsError('invalid', `第 ${index + 1} 块的图表「${series.name}」有 ${series.values.length} 个数，`
        + `横轴有 ${block.x.length} 个：图表只能用存下来的数据画，每个点都要有数。`);
    }
    if (series.values.some((value) => !Number.isFinite(value))) {
      throw new SubsError('invalid', `第 ${index + 1} 块的图表「${series.name}」里有不是数的值。`);
    }
  }
}

function checkFootnotes(markdown: string, sources: number, index: number): void {
  for (const match of markdown.matchAll(FOOTNOTE)) {
    const number = Number(match[1]);
    if (number < 1 || number > sources) {
      throw new SubsError('invalid', `第 ${index + 1} 块写了 [^${number}]，可出处只有 ${sources} 条：`
        + '每条说法的出处都要写进 sources。');
    }
  }
}

/** 合规就原样返回，不合规抛 SubsError（一句能照着改的话）。 */
export function checkSpaceDoc(doc: unknown): SpaceDoc {
  if (!Value.Check(SpaceDocSchema, doc)) {
    throw new SubsError('invalid', schemaMessage(doc));
  }
  const anchors = new Set<string>();
  doc.blocks.forEach((block, index) => {
    if (block.type === 'chart') {
      checkChart(block, index);
    } else if (block.type === 'text') {
      checkFootnotes(block.markdown, doc.sources.length, index);
    } else if (block.type === 'heading') {
      if (anchors.has(block.id)) {
        throw new SubsError('invalid', `小节锚点「${block.id}」重复了，每个小节要不同的 id。`);
      }
      anchors.add(block.id);
    }
  });
  return doc;
}

/** 一段太长就按空行切开，每块不超过上限。 */
function textBlocks(markdown: string): SpaceBlock[] {
  const trimmed = markdown.trim();
  if (trimmed === '') {
    return [];
  }
  const blocks: SpaceBlock[] = [];
  let current = '';
  for (const part of trimmed.split(/\n{2,}/)) {
    const piece = part.slice(0, SPACE_TEXT_MAX_CHARS);
    if (current !== '' && current.length + piece.length + 2 > SPACE_TEXT_MAX_CHARS) {
      blocks.push({ type: 'text', markdown: current });
      current = '';
    }
    current = current === '' ? piece : `${current}\n\n${piece}`;
  }
  if (current !== '') {
    blocks.push({ type: 'text', markdown: current });
  }
  return blocks;
}

/** Markdown → 空间正文：按「## 小节」切成小节标题和正文；第一行若就是标题（# 标题）去掉。 */
export function docFromMarkdown(title: string, markdown: string): SpaceDoc {
  const lines = markdown.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first >= 0 && (lines[first] ?? '').replace(/^#\s+/, '').trim() === title && /^#\s/.test(lines[first] ?? '')) {
    lines.splice(first, 1);
  }
  const blocks: SpaceBlock[] = [];
  let buffer: string[] = [];
  let fence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      fence = !fence;
    }
    const heading = fence ? null : /^##\s+(.+)$/.exec(line);
    if (heading?.[1] === undefined) {
      buffer.push(line);
      continue;
    }
    blocks.push(...textBlocks(buffer.join('\n')));
    buffer = [];
    blocks.push({ type: 'heading', id: `s${blocks.length + 1}`, text: heading[1].trim().slice(0, HEADING_MAX) });
  }
  blocks.push(...textBlocks(buffer.join('\n')));
  return { stats: [], blocks: blocks.slice(0, BLOCKS_MAX), sources: [] };
}

/** 信息流顶部、首页「回顾」、订阅列表用的那一句和几个重点。 */
export function summaryOf(title: string, doc: Pick<SpaceDoc, 'headline' | 'stats'>):
  { headline: string; stats: SpaceDoc['stats'] } {
  return { headline: doc.headline ?? title, stats: doc.stats };
}
