// 旧记忆条目和约定的「原话出处」：条目的锚点是一条他说的话（2026-11-05 起旧对话迁进主线，锚点是 line:<线>:<seq>）
// 或一篇笔记。证据和来源账随判断一起删了，这里只剩读原话。

import type { SourceContext } from '../../shared/api/lineage.ts';
import type { MemoryEntry } from '../../shared/state.ts';
import { allPages, type StateService } from '../state/index.ts';

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

/** 约定引的那句原话：找同一句的旧记忆条目，读它的出处；找不到就只给原话本身。 */
export function agreementSource(state: SourceState, quote: string | null, at: string | null): SourceContext | null {
  if (quote === null) {
    return null;
  }
  const candidates = allPages((page) => state.memory.listAll({ kind: 'quote' }, page))
    .filter((row) => row.text === quote && row.deletedAt === null);
  const entry = at === null ? candidates.length === 1 ? candidates[0] : undefined
    : candidates.find((row) => Date.parse(row.createdAt) === Date.parse(at));
  return memorySource(state, entry?.anchor ?? null)
    ?? { kind: 'quote', ref: entry?.id ?? '', text: quote, chatId: null, at };
}
