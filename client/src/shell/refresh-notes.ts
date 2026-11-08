import type { PlasticineApi } from '../api/client.ts';
import { createRequestId } from '../api/request-id.ts';
import type { ClientState } from '../state/context.tsx';
import { NoteSaver } from '../views/notes/note-saver.ts';
export function refreshBlockers(state: ClientState): string[] {
  const blockers: string[] = [];
  const composer = state.conversationUi.store.get();
  if ((composer.draft !== '' || composer.quotes.length > 0) && !state.conversationUi.savedForRefresh()) {
    blockers.push('还有对话草稿或引用');
  }
  if (state.noteDrafts.hasAny()) {
    blockers.push('还有未保存笔记');
  }
  if (state.attachments.hasAny()) {
    blockers.push('还有对话附件或未完成上传');
  }
  if (state.outbox.hasAny()) {
    blockers.push('还有待发送或待核实的消息');
  }
  if (state.noteOps.hasPending() || state.actionOps.hasPending()) {
    blockers.push('还有写入操作待核实');
  }
  if (state.inlineDrafts.hasAny() || state.editDrafts.hasAny()) {
    blockers.push('还有未保存的编辑');
  }
  if (state.signedOps.hasPending()) {
    blockers.push('还有确认操作待核实');
  }
  if ([...state.noteDrafts.savers].some((saver) => !saver.readyForRefresh())) {
    blockers.push('笔记尚未全部保存成功，或输入法仍在组合');
  }
  return blockers;
}
/** 用户点保存后才调用；离屏草稿仍以原基准版本保存，不自动解决冲突。 */
export async function saveNotesForRefresh(api: PlasticineApi, state: ClientState): Promise<string[]> {
  const edits = state.noteDrafts.edits;
  for (const saver of [...state.noteDrafts.savers]) {
    await saver.flush();
  }
  // 已有 saver 包括刚卸载仍在写入的编辑器；先等它们，再为没有编辑器的离屏草稿建立保存流程。
  const ids = new Set(state.noteDrafts.store.get().keys());
  for (const operation of state.actionOps.store.get()) {
    if (operation.request.kind === 'note_save') {
      ids.add(operation.request.noteId);
    }
  }
  const errors: string[] = [];
  for (const id of ids) {
    if (state.noteDrafts.savers.size > 0) {
      // 未解决的旧 saver 不另起一个覆盖其冲突或输入法状态。
      if ([...state.noteDrafts.savers].some((saver) => !saver.readyForRefresh())) {
        continue;
      }
    }
    try {
      const note = await api.notes.get(id);
      if (note.readOnly) {
        errors.push('有只读笔记无法保存，请回笔记页检查。');
        continue;
      }
      const saver = new NoteSaver({
        note,
        drafts: state.noteDrafts,
        actionOps: state.actionOps,
        newRequestId: createRequestId,
        save: (noteId, body) => api.notes.save(noteId, body),
      });
      await saver.flush();
      saver.dispose(false);
    } catch {
      errors.push('有笔记未能读取或保存，请回笔记页核对');
    }
  }
  if (edits !== state.noteDrafts.edits) {
    errors.push('保存期间有新输入，请再次确认刷新');
  }
  try {
    state.conversationUi.saveForRefresh();
  } catch {
    errors.push('对话草稿未保存，请检查浏览器存储后重试');
  }
  return [...errors, ...refreshBlockers(state)];
}
