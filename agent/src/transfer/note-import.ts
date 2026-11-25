import { NOTE_ASSETS_PATH } from '../../shared/api/notes.ts';
import { NOTE_MAX_CHARS, type NoteInput, type NoteRecord } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { splitFrontMatter } from './front-matter.ts';
import { decodeText } from './text-decode.ts';

export interface TransferFile {
  name: string;
  data: Buffer;
}

export interface SkippedFile {
  name: string;
  reason: string;
}

export interface ImportedNotes {
  imported: NoteRecord[];
  skipped: SkippedFile[];
}

export interface NoteImportOptions {
  folder: string;
  author: NoteInput['author'];
  now: () => Date;
}

type NoteState = Pick<StateService, 'notes'>;

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const HEADING_LINE = /^#{1,6}\s+\S/;
const RELATIVE_ASSET = new RegExp('(\\]\\(\\s*<?|\\ssrc=["\']|^ {0,3}\\[[^\\]\\n]+\\]:\\s*<?)(?:\\./)?assets/'
  + '([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\\.(?:png|jpe?g|gif|webp))', 'gim');

export function splitFileName(name: string): { base: string; extension: string } {
  const leaf = name.split(/[\\/]/).at(-1) ?? name;
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) {
    return { base: leaf.trim(), extension: '' };
  }
  return { base: leaf.slice(0, dot).trim(), extension: leaf.slice(dot + 1).toLowerCase() };
}

function textToMarkdown(text: string): string {
  return text.split('\n').map((line) => line.replace(/^[ \t]+/, '').trimEnd()).filter((line) => line !== '')
    .join('\n\n');
}

function timeOf(value: string | undefined, now: Date): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now.getTime() ? new Date(at).toISOString() : undefined;
}

interface Draft {
  markdown: string;
  createdAt?: string;
  updatedAt?: string;
}

function markdownDraft(text: string, base: string, now: Date): Draft {
  const front = splitFrontMatter(text);
  const body = (front?.body ?? text).trim();
  if (body === '') {
    return { markdown: '' };
  }
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  const extra = front === null || front.rest.length === 0 ? [] : ['', '```yaml', ...front.rest, '```'];
  if (HEADING_LINE.test(lines[first] ?? '')) {
    lines.splice(first + 1, 0, ...extra);
  } else {
    const title = (front?.fields.get('title') ?? base).replace(/\s+/g, ' ').trim();
    lines.unshift(`# ${title === '' ? '未命名' : title}`, ...extra, '');
  }
  const createdAt = timeOf(front?.fields.get('created'), now);
  const updatedAt = timeOf(front?.fields.get('updated'), now);
  return {
    markdown: lines.join('\n'),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined || (createdAt !== undefined && updatedAt < createdAt) ? {}
      : { updatedAt, createdAt: createdAt ?? updatedAt }),
  };
}

function draftOf(file: TransferFile, now: Date): Draft | string {
  const { base, extension } = splitFileName(file.name);
  if (!MARKDOWN_EXTENSIONS.has(extension) && extension !== 'txt') {
    return '不是 .md 或 .txt 文件';
  }
  const text = decodeText(file.data);
  if (text === null) {
    return '不是文字文件';
  }
  if (extension !== 'txt') {
    return markdownDraft(text, base, now);
  }
  const body = textToMarkdown(text);
  return { markdown: body === '' ? '' : `# ${base === '' ? '未命名' : base}\n\n${body}` };
}

export function importNotes(state: NoteState, files: readonly TransferFile[], options: NoteImportOptions)
  : ImportedNotes {
  const now = options.now();
  const imported: NoteRecord[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const draft = draftOf(file, now);
    if (typeof draft === 'string') {
      skipped.push({ name: file.name, reason: draft });
      continue;
    }
    if (draft.markdown === '') {
      skipped.push({ name: file.name, reason: '文件是空的' });
      continue;
    }
    const markdown = draft.markdown.replace(RELATIVE_ASSET, (whole: string, lead: string, name: string) =>
      (state.notes.readAsset(name) === undefined ? whole : `${lead}${NOTE_ASSETS_PATH}/${name}`));
    if (markdown.length > NOTE_MAX_CHARS) {
      skipped.push({ name: file.name, reason: `超过 ${NOTE_MAX_CHARS / 10_000} 万字，一篇笔记放不下` });
      continue;
    }
    imported.push(state.notes.create({ markdown, folder: options.folder, author: options.author }, {
      ...(draft.createdAt === undefined ? {} : { createdAt: draft.createdAt }),
      ...(draft.updatedAt === undefined ? {} : { updatedAt: draft.updatedAt }),
    }));
  }
  return { imported, skipped };
}
