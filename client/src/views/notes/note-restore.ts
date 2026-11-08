// 恢复可能已落地但回执没到：正文会先收到 SSE、恢复按钮随之消失，原请求仍由笔记页核实。
import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import { restoreNoteOp, type NoteOps } from '../../state/note-ops.ts';

export async function restoreNote(api: PlasticineApi, noteOps: NoteOps, noteId: string): Promise<boolean> {
  const key = restoreNoteOp(noteId);
  if (noteOps.get(key)?.status === 'running') { return false; }
  const requestId = noteOps.begin(key, createRequestId);
  try {
    await api.notes.restore(noteId, requestId);
    noteOps.succeed(key);
    return true;
  } catch (cause) {
    noteOps.fail(key, cause);
    return false;
  }
}

export function restoreOpNoteId(key: string): string | null {
  const prefix = restoreNoteOp('');
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}
