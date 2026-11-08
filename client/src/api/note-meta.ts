// 一篇笔记去掉正文就是列表里的那一条（NoteViewSchema 正是 NoteMetaViewSchema 加 markdown）。

import type { NoteMetaView, NoteView } from './types.ts';

export function toMeta(note: NoteView): NoteMetaView {
  const { markdown: _markdown, ...meta } = note;
  return meta;
}
