import type { NoteView, Quote } from '../../api/types.ts';
import { quoteLimitMessage } from '../../api/shared.ts';

/** 调用方先保存编辑器，再传入 saver.current()，保证预览和服务端读取的是同一版本。 */
export function buildNoteQuote(note: NoteView,
  options: { selection?: string; selectionKey?: string } = {}): Quote {
  if (note.private) {
    throw new Error('这篇笔记是私密笔记，不能直接引用给对话模型。需要讨论时，请明确复制愿意提供的文字。');
  }
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
