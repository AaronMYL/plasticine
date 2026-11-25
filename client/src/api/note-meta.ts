import type { NoteMetaView, NoteView } from './types.ts';

export function toMeta(note: NoteView): NoteMetaView {
  const { markdown: _markdown, ...meta } = note;
  return meta;
}
