// 笔记导出（照 Obsidian 的习惯，11-18 用户弹框定）：一篇一个 .md，文件名用标题，开头的属性块带创建和修改时间；
// 正文里 Plasticine 自己的图（/v2/notes/assets/…）放进同目录的 assets/，链接改成相对路径。
// 一篇没有图的直接是一个 .md；有图的、多篇的打成一个 zip，多篇时按文件夹分目录。

import { writeZip, type ZipFile } from '../artifacts/index.ts';
import { LEGACY_NOTE_ASSETS_PATH, NOTE_ASSETS_PATH } from '../../shared/api/notes.ts';
import type { NoteRecord } from '../../shared/state.ts';
import { noteAssetRefs, type StateService } from '../state/index.ts';
import { createNamer, safeFileName } from './file-name.ts';
import { frontMatterBlock } from './front-matter.ts';

export interface ExportedFile {
  /** 下载时的文件名。 */
  name: string;
  type: string;
  data: Buffer;
}

type NoteState = Pick<StateService, 'notes'>;

export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';
export const ZIP_TYPE = 'application/zip';
const ASSETS_DIRECTORY = 'assets';

interface NoteFile {
  title: string;
  folder: string;
  text: string;
  assets: Map<string, Buffer>;
}

function noteFile(state: NoteState, note: NoteRecord): NoteFile {
  let body = state.notes.readBody(note);
  const assets = new Map<string, Buffer>();
  for (const name of noteAssetRefs(body)) {
    const asset = state.notes.readAsset(name);
    if (asset === undefined) {
      continue;
    }
    assets.set(name, asset.data);
    for (const prefix of [NOTE_ASSETS_PATH, LEGACY_NOTE_ASSETS_PATH]) {
      body = body.replaceAll(`${prefix}/${name}`, `${ASSETS_DIRECTORY}/${name}`);
    }
  }
  const front = frontMatterBlock({ created: note.createdAt, updated: note.updatedAt });
  return { title: note.title, folder: note.folder, text: `${front}${body.trimEnd()}\n`, assets };
}

/** 这几篇笔记导出成一个文件（.md 或 zip）。有一篇找不到就抛错。 */
export function exportNotes(state: NoteState, ids: readonly string[]): ExportedFile {
  const files = [...new Set(ids)].map((id) => noteFile(state, state.notes.require(id)));
  const single = files.length === 1 ? files[0] : undefined;
  if (single !== undefined && single.assets.size === 0) {
    return { name: `${safeFileName(single.title, '未命名')}.md`, type: MARKDOWN_TYPE,
      data: Buffer.from(single.text, 'utf8') };
  }
  const name = createNamer();
  const entries = new Map<string, ZipFile>();
  for (const file of files) {
    const directory = single === undefined ? safeFileName(file.folder, '笔记') : '';
    const path = name(directory, safeFileName(file.title, '未命名'), 'md');
    entries.set(path, { name: path, data: file.text });
    for (const [asset, data] of file.assets) {
      const assetPath = `${directory === '' ? '' : `${directory}/`}${ASSETS_DIRECTORY}/${asset}`;
      entries.set(assetPath, { name: assetPath, data });
    }
  }
  const zipName = single === undefined ? `Plasticine 笔记（${files.length} 篇）`
    : safeFileName(single.title, '未命名');
  return { name: `${zipName}.zip`, type: ZIP_TYPE, data: writeZip([...entries.values()]) };
}
