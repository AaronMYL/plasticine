// 删除一篇笔记，用 state/note-ops.ts 里记着的 request_id（约定 1）。编辑器里的「删除」和笔记页顶上的
// 「待核实的删除」走同一个函数：删除生效后那一篇从列表里消失，编辑器也就没了，核实入口不能只放在编辑器里。

import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import { deleteNoteOp, type NoteOps } from '../../state/note-ops.ts';

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
