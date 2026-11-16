// 旧记忆条目的「原话出处」：条目的锚点是一条他说的话（2026-11-05 起旧对话迁进主线，锚点是 line:<线>:<seq>）
// 或一篇笔记。证据和来源账随判断一起删了，这里只剩读原话。

import type { SourceContext } from '../../shared/api/lineage.ts';
import type { MemoryEntry } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

type SourceState = Pick<StateService, 'lineMessages' | 'notes' | 'memory'>;

/** 已认证界面的原文来源；模型上下文另有自己的私密过滤。 */
export function memorySource(state: SourceState, anchor: MemoryEntry['anchor']): SourceContext | null {
  if (anchor?.kind === 'message') {
    const said = state.lineMessages.said(anchor.ref);
    return said === undefined ? null : { kind: 'message', ref: said.ref, text: said.text, chatId: said.lineId,
      at: said.createdAt };
  }
  if (anchor?.kind === 'note') {
    const note = state.notes.get(anchor.ref);
    if (note === undefined || note.deletedAt !== null) {
      return null;
    }
    return { kind: 'note', ref: note.id, text: state.notes.readBody(note), chatId: null, at: note.updatedAt };
  }
  return null;
}
