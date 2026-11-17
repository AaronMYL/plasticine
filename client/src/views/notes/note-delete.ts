// 删除一篇笔记，用 state/note-ops.ts 里记着的 request_id（约定 1）。编辑器里的「删除」和笔记页顶上的
// 「待核实的删除」走同一个函数：删除生效后那一篇从列表里消失，编辑器也就没了，核实入口不能只放在编辑器里。

import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import { showResultToast, showToast } from '../../primitives/toast/index.tsx';
import { deleteNoteOp, type NoteOps } from '../../state/note-ops.ts';
import { restoreNote } from './note-restore.ts';

/** 返回是否拿到了明确结果（删掉了）；没拿到时状态记在 noteOps 里，界面照它显示「再核实」或原因。 */
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

/** noteOps 里所有删除操作对应的笔记 id。 */
export function deleteOpNoteId(key: string): string | null {
  const prefix = deleteNoteOp('');
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * 「删除笔记」（编辑器的 ⋯ 和列表一行的 ⋯ 同一个）：笔记进「最近删除」、找得回，所以不先问，直接删，底部给撤销
 * （11-17 Aaron 弹框选「直接删，底部出撤销」，和图书馆、空间一样）。没删成就在底部说原因；
 * 结果不明的仍记在 noteOps 里，笔记页顶上照旧能「再核实」。
 */
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
