// 笔记导入：一次选的几个 .md / .txt 各成一篇笔记，进指定的文件夹。
// - 标题：正文第一行是标题（# …）就照它；不是的话用属性块里的 title，再没有用文件名，在最前面补一行标题。
// - TXT 一行一段（中文的 txt 多半一行就是一段），行首的空格去掉，免得被当成代码。
// - 开头的属性块（导出时写的创建、修改时间）读回来；别的属性留成一段 yaml 代码，不丢。
// - 图片不带：导出时改成相对路径的图（assets/名字），这台 Plasticine 里还有同名的就接回去；别的照原样留在正文里，
//   界面把读不到的图显示成一行灰字。
// 一个文件不行（不是文字、空的、太长）不影响别的；没导入的连同原因一起交回。

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
/** 图片的三种写法里指向 assets/ 的相对路径：![](assets/x.png)、<img src="assets/x.png">、[标签]: assets/x.png。 */
const RELATIVE_ASSET = new RegExp('(\\]\\(\\s*<?|\\ssrc=["\']|^ {0,3}\\[[^\\]\\n]+\\]:\\s*<?)(?:\\./)?assets/'
  + '([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\\.(?:png|jpe?g|gif|webp))', 'gim');

/** 文件名拆成名字和扩展名（小写）；没有扩展名的扩展名是空串。 */
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

/** 属性块里写的时间：读得出来、又不在将来才认。 */
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
    // 修改时间不能早于创建时间；只写了修改时间的，创建时间也算那时候。
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
