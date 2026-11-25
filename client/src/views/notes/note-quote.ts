import type { NoteView, Quote } from '../../api/types.ts';
import { quoteLimitMessage } from '../../api/shared.ts';

export function buildNoteQuote(note: NoteView,
  options: { selection?: string; selectionKey?: string } = {}): Quote {
  if (note.deletedAt !== null) {
    throw new Error('这篇笔记已在回收站。请先恢复笔记，再引用到对话。');
  }
  const selection = options.selection;
  const selected = selection !== undefined && selection.trim() !== '';
  const text = selected ? selection : note.markdown;
  const limit = quoteLimitMessage([{ text }]);
  if (limit !== null) { throw new Error(limit); }
  const reference = { noteId: note.id, version: note.version };
  return { id: `quote_${note.id}_v${note.version}_${selected ? options.selectionKey ?? 'selection' : 'full'}`,
    kind: 'note', sourceId: note.id, label: `《${note.title === '' ? '未命名' : note.title}》`, text,
    noteReference: selected ? { ...reference, scope: 'selection', text } : { ...reference, scope: 'full' } };
}
