import { LEGACY_NOTE_ASSETS_PATH, NOTE_ASSETS_PATH } from '../../shared/api/notes.ts';
import type { Space } from '../../shared/state.ts';
import { imageInfo, makeDocx, markdownBlocks, writeZip, type Block, type ImageData, type ZipFile }
  from '../artifacts/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import { blocksMarkdown } from './blocks-markdown.ts';
import { createNamer, safeFileName } from './file-name.ts';
import { htmlBlocks } from './html-blocks.ts';
import { MARKDOWN_TYPE, ZIP_TYPE, type ExportedFile } from './note-export.ts';

export const SPACE_DATA_FORMATS = ['markdown', 'docx'] as const;
export type SpaceDataFormat = (typeof SPACE_DATA_FORMATS)[number];

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DATA_IMAGE = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/i;

type SpaceState = Pick<StateService, 'spaces' | 'notes'>;

function title(inline: string): Block {
  return { kind: 'heading', level: 1, inline: [{ text: inline }] };
}

export function spaceBlocks(space: Space): Block[] {
  if (space.html !== null) {
    const blocks = htmlBlocks(space.html);
    return space.genre === 'letter' ? [title(space.title), ...blocks] : blocks;
  }
  const doc = space.doc;
  const blocks: Block[] = [title(doc.headline ?? space.title)];
  for (const block of doc.blocks) {
    if (block.type === 'heading') blocks.push({ kind: 'heading', level: 2, inline: [{ text: block.text }] });
    else if (block.type === 'text') blocks.push(...markdownBlocks(block.markdown));
    else if (block.type === 'quote') blocks.push({ kind: 'quote', inline: [{ text: block.text }] });
    else if (block.type === 'image') blocks.push({ kind: 'image', src: block.url, alt: block.alt });
    else blocks.push({ kind: 'paragraph', inline: [{ text: `［图表：${block.title}］${block.caption}` }] });
  }
  return blocks;
}

function assetName(src: string): string | null {
  for (const prefix of [NOTE_ASSETS_PATH, LEGACY_NOTE_ASSETS_PATH]) {
    if (src.startsWith(`${prefix}/`)) return decodeURIComponent(src.slice(prefix.length + 1).split(/[?#]/)[0] ?? '');
  }
  return null;
}

function imageBytes(state: SpaceState, src: string): Buffer | null {
  const name = assetName(src);
  if (name !== null) {
    try {
      return state.notes.readAsset(name)?.data ?? null;
    } catch (error) {
      if (error instanceof StateError) return null;
      throw error;
    }
  }
  const data = DATA_IMAGE.exec(src)?.[1];
  return data === undefined ? null : Buffer.from(data, 'base64');
}

interface SpaceFile {
  title: string;
  data: Buffer | string;
  assets: Map<string, Buffer>;
}

function markdownFile(state: SpaceState, space: Space): SpaceFile {
  const assets = new Map<string, Buffer>();
  const text = blocksMarkdown(spaceBlocks(space), (src) => {
    const name = assetName(src);
    const data = name === null ? null : imageBytes(state, src);
    if (name === null || data === null) return src;
    assets.set(name, data);
    return `assets/${name}`;
  });
  return { title: space.title, data: text, assets };
}

function docxFile(state: SpaceState, space: Space): SpaceFile {
  const image = (src: string): ImageData | null => {
    const data = imageBytes(state, src);
    return data === null ? null : imageInfo(data);
  };
  return { title: space.title, data: makeDocx(spaceBlocks(space), image), assets: new Map() };
}

export function exportSpaces(state: SpaceState, ids: readonly string[], format: SpaceDataFormat): ExportedFile {
  const spaces = [...new Set(ids)].map((id) => state.spaces.require(id));
  const files = spaces.map((space) => (format === 'docx' ? docxFile(state, space) : markdownFile(state, space)));
  const extension = format === 'docx' ? 'docx' : 'md';
  const single = files.length === 1 ? files[0] : undefined;
  if (single !== undefined && single.assets.size === 0) {
    const data = typeof single.data === 'string' ? Buffer.from(single.data, 'utf8') : single.data;
    return { name: `${safeFileName(single.title, '未命名')}.${extension}`, type: format === 'docx' ? DOCX_TYPE
      : MARKDOWN_TYPE, data };
  }
  const name = createNamer();
  const entries = new Map<string, ZipFile>();
  for (const file of files) {
    const path = name('', safeFileName(file.title, '未命名'), extension);
    entries.set(path, { name: path, data: file.data });
    for (const [asset, data] of file.assets) entries.set(`assets/${asset}`, { name: `assets/${asset}`, data });
  }
  const zipName = single === undefined ? `Plasticine 资料库（${files.length} 篇）` : safeFileName(single.title, '未命名');
  return { name: `${zipName}.zip`, type: ZIP_TYPE, data: writeZip([...entries.values()]) };
}
