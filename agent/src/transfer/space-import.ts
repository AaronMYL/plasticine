import { EMPTY_SPACE_DOC, SPACE_TITLE_MAX_CHARS, type Space, type SpaceAuthor } from '../../shared/state.ts';
import { NOTE_ASSETS_PATH } from '../../shared/api/notes.ts';
import { decodeEntities } from '../../shared/space-html.ts';
import { markdownBlocks, type Block } from '../artifacts/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import { checkSpacePage, SubsError } from '../subs/index.ts';
import { docxBlocks } from './docx-blocks.ts';
import { splitFrontMatter } from './front-matter.ts';
import { htmlBlocks } from './html-blocks.ts';
import { splitFileName, type SkippedFile, type TransferFile } from './note-import.ts';
import { leadingTitle, reportFragment } from './report-fragment.ts';
import { readSpaceMarker } from '../../shared/space-marker.ts';
import { decodeText } from './text-decode.ts';

export interface ImportedSpaces {
  imported: Space[];
  skipped: SkippedFile[];
}

type SpaceImportState = Pick<StateService, 'spaces' | 'notes'>;

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp' };
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i;
const RELATIVE_ASSET = /^(?:\.\/)?assets\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|gif|webp))$/i;

interface Draft {
  title: string;
  genre: 'report' | 'letter';
  html: string;
}

function saveImage(state: SpaceImportState, data: Buffer, type: string): string | null {
  try {
    return `${NOTE_ASSETS_PATH}/${state.notes.writeAsset(data, type).name}`;
  } catch (error) {
    if (error instanceof StateError) return null;
    throw error;
  }
}

function localImage(state: SpaceImportState, src: string): string {
  const data = DATA_IMAGE.exec(src.trim());
  if (data !== null) {
    return saveImage(state, Buffer.from((data[2] ?? '').replace(/\s/g, ''), 'base64'), (data[1] ?? '').toLowerCase())
      ?? '内嵌的图（格式不认或超过 10 MB）';
  }
  const relative = RELATIVE_ASSET.exec(src.trim())?.[1];
  if (relative !== undefined && state.notes.readAsset(relative) !== undefined) {
    return `${NOTE_ASSETS_PATH}/${relative}`;
  }
  return src;
}

function withLocalImages(state: SpaceImportState, blocks: readonly Block[]): Block[] {
  return blocks.map((block) => (block.kind === 'image' ? { ...block, src: localImage(state, block.src) } : block));
}

function pageTitle(page: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1];
  const text = title === undefined ? '' : decodeEntities(title).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function textBlocks(text: string): Block[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    .map((line) => ({ kind: 'paragraph', inline: [{ text: line }] }));
}

function draftOf(state: SpaceImportState, file: TransferFile): Draft | string {
  const { base, extension } = splitFileName(file.name);
  let blocks: Block[] | null;
  let title: string | null = null;
  if (extension === 'docx') {
    blocks = docxBlocks(file.data, (data, name) => saveImage(state, data,
      IMAGE_TYPES[splitFileName(name).extension] ?? ''));
    if (blocks === null) return '读不了这个 Word 文件（可能是旧的 .doc 或加了密）';
  } else if (['md', 'markdown', 'txt', 'html', 'htm'].includes(extension)) {
    const text = decodeText(file.data);
    if (text === null) return '不是文字文件';
    if (extension === 'html' || extension === 'htm') {
      const marker = readSpaceMarker(text);
      if (marker !== null) return marker;
      title = pageTitle(text);
      blocks = htmlBlocks(text);
    } else if (extension === 'txt') {
      blocks = textBlocks(text);
    } else {
      const front = splitFrontMatter(text);
      title = front?.fields.get('title') ?? null;
      blocks = markdownBlocks(front?.body ?? text);
    }
  } else {
    return '只收 Markdown、TXT、Word（.docx）和网页文件';
  }
  if (blocks.length === 0) return '文件里没有内容';
  const fallback = (title ?? (base === '' ? '未命名' : base)).trim();
  const local = withLocalImages(state, blocks);
  return { title: leadingTitle(local) ?? fallback, genre: 'report', html: reportFragment(local, fallback) };
}

function clipTitle(title: string): string {
  const chars = Array.from(title.replace(/\s+/g, ' ').trim());
  const clipped = chars.slice(0, SPACE_TITLE_MAX_CHARS).join('');
  return clipped === '' ? '未命名' : clipped;
}

export function importSpaces(state: SpaceImportState, files: readonly TransferFile[], author: SpaceAuthor)
  : ImportedSpaces {
  const imported: Space[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const draft = draftOf(state, file);
    if (typeof draft === 'string') {
      skipped.push({ name: file.name, reason: draft });
      continue;
    }
    try {
      const page = checkSpacePage(draft.genre, draft.html);
      imported.push(state.spaces.create({ title: clipTitle(draft.title), doc: EMPTY_SPACE_DOC, genre: draft.genre,
        html: page.html, author, category: 'report' }, { change: '从文件导入' }));
    } catch (error) {
      if (!(error instanceof SubsError)) throw error;
      skipped.push({ name: file.name, reason: error.message.split('：')[0] ?? error.message });
    }
  }
  return { imported, skipped };
}
