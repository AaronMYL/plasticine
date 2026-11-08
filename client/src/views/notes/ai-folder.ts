// 「Plasticine 写的」文件夹（2026-11-05 设计稿 Notes）：Plasticine 自己写的笔记（原来的成果迁进来）放在这里，文件夹用星形
// 图标，笔记标题后带 ✦。认法：在这个文件夹里，或者最后一版是 Plasticine 写的。

import type { NoteMetaView } from '../../api/shared.ts';

export const AI_NOTE_FOLDER = 'Plasticine 写的';

export function isAiFolder(folder: string): boolean {
  return folder === AI_NOTE_FOLDER;
}

export function isAiNote(note: Pick<NoteMetaView, 'folder' | 'author'>): boolean {
  return isAiFolder(note.folder) || note.author === 'ai';
}
