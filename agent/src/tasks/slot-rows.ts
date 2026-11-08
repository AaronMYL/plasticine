// 登记进「定时」的那几行（订阅、回顾、心跳、做梦）共用的一格「上次」：从 timed_slots 那一行读。在跑、等你看线。

import type { LineView, TaskGlyph } from '../../shared/api/index.ts';
import type { TimedSlot } from '../../shared/state.ts';

/** 「上次」那一格写得下的字数（设计稿那一列 150px）。 */
export const SLOT_LAST_MAX_CHARS = 14;

export function shortNote(text: string, max = SLOT_LAST_MAX_CHARS): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

export function slotLast(slot: TimedSlot | undefined, view: LineView | null, on: boolean)
  : { glyph: TaskGlyph; text: string } | null {
  if (view?.status === 'waiting') {
    return { glyph: 'wait', text: '等你' };
  }
  if (view?.status === 'running' || view?.status === 'queued') {
    return { glyph: 'run', text: '在做' };
  }
  if (!on) {
    return { glyph: 'pause', text: '暂停了' };
  }
  if (slot === undefined) {
    return null;
  }
  const note = slot.lastNote;
  switch (slot.lastOutcome) {
    case 'done': return { glyph: 'done', text: shortNote(note ?? '做完了') };
    case 'quiet': return { glyph: 'done', text: shortNote(note ?? '没事') };
    case 'unmet': return { glyph: 'err', text: shortNote(note ?? '没做成') };
    case 'failed': return { glyph: 'err', text: shortNote(note ?? '出错了') };
    case 'stopped': return { glyph: 'pause', text: '叫停了' };
    case 'skipped': return { glyph: 'idle', text: shortNote(note ?? '跳过了') };
    case null: return note === null ? null : { glyph: 'idle', text: shortNote(note) };
  }
}
