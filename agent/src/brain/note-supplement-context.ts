import type { NoteAssistRequest, NoteSupplementReference } from '../../shared/api/notes-workspace.ts';
import type { StateService } from '../state/index.ts';

/** 只交正文实际提到的联系人和非私密笔记，关联建议没有凭空造 ID 的余地。 */
export function noteSupplementReferences(state: StateService | undefined, input: NoteAssistRequest)
  : NoteSupplementReference[] {
  if (state === undefined) return [];
  const text = [input.before ?? input.markdown, input.selected ?? '', input.after ?? ''].join('\n');
  const contacts: NoteSupplementReference[] = state.contacts.active()
    .filter((row) => row.displayName.length > 1 && text.includes(row.displayName))
    .map((row) => ({ kind: 'contact', id: row.id, label: row.displayName }));
  const notes: NoteSupplementReference[] = state.notes.list({ readable: (row) => !row.private }, { limit: 500 })
    .filter((row) => !row.private && row.title.length > 1 && text.includes(row.title))
    .map((row) => ({ kind: 'note', id: row.id, label: row.title }));
  return [...contacts, ...notes].slice(0, 12);
}
