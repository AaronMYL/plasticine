import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import { showResultToast, showToast } from '../../primitives/toast/index.tsx';
import { deleteNoteOp, type NoteOps } from '../../state/note-ops.ts';
import { restoreNote } from './note-restore.ts';

export async function deleteNote(api: PlasticineApi, noteOps: NoteOps, noteId: string): Promise<boolean> {
  const key = deleteNoteOp(noteId);
  const requestId = noteOps.begin(key, createRequestId);
  try {
    await api.notes.remove(noteId, requestId);
    noteOps.succeed(key);
    return true;
  } catch (cause) {
    noteOps.fail(key, cause);
    return false;
  }
}

export function deleteOpNoteId(key: string): string | null {
  const prefix = deleteNoteOp('');
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

export async function removeNoteWithUndo(api: PlasticineApi, noteOps: NoteOps, note: { id: string; title: string },
  after?: () => void): Promise<void> {
  const name = note.title.trim() === '' ? '这篇笔记' : `「${note.title.trim()}」`;
  if (!await deleteNote(api, noteOps, note.id)) {
    const failed = noteOps.get(deleteNoteOp(note.id));
    if (failed?.status === 'failed' && failed.error !== null) {
      showResultToast(failed.error, true);
    }
    return;
  }
  after?.();
  showToast({ text: `已把${name}移到最近删除`, action: { label: '撤销', icon: 'undo', run: () => {
    void restoreNote(api, noteOps, note.id).then((restored) => {
      showResultToast(restored ? `${name}放回来了` : '没放回来，可以到「最近删除」里恢复', !restored);
    });
  } } });
}
