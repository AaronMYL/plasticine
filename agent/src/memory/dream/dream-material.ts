import type { MemoryAnchor, MemoryJournalEntry } from '../../../shared/state.ts';
import { plainText, type LineMessageRow, type StateService } from '../../state/index.ts';
import type { CurationSource } from '../curation/memory-curation-ops.ts';

const MESSAGE_CHARS = 1_500;
const TOOL_CHARS = 300;
export const ROUND_CHARS = 30_000;
export const MAX_ROUNDS = 3;

export type TranscriptState = Pick<StateService, 'lineMessages' | 'lines'>;

export interface Transcript {
  lineId: string;
  text: string;
  said: string[];
  other: string[];
  messages: number;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function speaker(row: LineMessageRow): { who: string; max: number; stated: boolean } | null {
  const origin = row.meta?.origin?.kind;
  switch (row.role) {
    case 'user':
      if (origin === 'user') {
        return { who: '他', max: MESSAGE_CHARS, stated: true };
      }
      return { who: origin === 'network' ? '别人发来（资料）' : '交给这条线的话', max: MESSAGE_CHARS, stated: false };
    case 'assistant':
    case 'welcome':
    case 'letter':
      return { who: 'Plasticine', max: MESSAGE_CHARS, stated: false };
    case 'toolResult':
      return { who: '工具结果（资料）', max: TOOL_CHARS, stated: false };
    case 'notice':
    case 'lineReport':
      return { who: '系统', max: TOOL_CHARS, stated: false };
    default:
      return null;
  }
}

export function transcripts(state: TranscriptState, from: string, to: string, limit: number): Transcript[] {
  const byLine = new Map<string, LineMessageRow[]>();
  for (const row of state.lineMessages.inRange(from, to, limit)) {
    byLine.set(row.lineId, [...byLine.get(row.lineId) ?? [], row]);
  }
  return [...byLine.entries()].map(([lineId, rows]) => {
    const line = state.lines.get(lineId);
    const head = `## 线「${line?.title ?? lineId}」（${line?.kind ?? 'background'}）`;
    const said: string[] = [];
    const other: string[] = [];
    const body = rows.flatMap((row) => {
      const who = speaker(row);
      const text = plainText(row.message).trim();
      if (who === null || text === '') {
        return [];
      }
      const ref = `line:${lineId}:${row.seq}`;
      (who.stated ? said : other).push(ref);
      return [`[${ref}] ${who.who}：${clip(text, who.max)}`];
    });
    return { lineId, text: [head, ...body].join('\n'), said, other, messages: body.length };
  }).filter((item) => item.messages > 0);
}

export function rounds(items: readonly Transcript[]): Transcript[][] {
  const result: Transcript[][] = [];
  let current: Transcript[] = [];
  let size = 0;
  for (const item of items) {
    const chars = Array.from(item.text).length;
    if (current.length > 0 && size + chars > ROUND_CHARS) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(item.text.length > ROUND_CHARS ? { ...item, text: clip(item.text, ROUND_CHARS) } : item);
    size += Math.min(chars, ROUND_CHARS);
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result.slice(0, MAX_ROUNDS);
}

export function journalRef(entry: MemoryJournalEntry): string {
  return `journal:${entry.id}`;
}

export function dreamSources(items: readonly Transcript[], journal: readonly MemoryJournalEntry[])
  : Map<string, CurationSource> {
  const sources = new Map<string, CurationSource>();
  for (const item of items) {
    for (const ref of item.said) {
      sources.set(ref, { anchors: [{ kind: 'message', ref }], stated: true });
    }
    for (const ref of item.other) {
      sources.set(ref, { anchors: [{ kind: 'message', ref }], stated: false });
    }
  }
  for (const entry of journal) {
    sources.set(journalRef(entry), { anchors: entry.anchors as MemoryAnchor[], stated: true });
  }
  return sources;
}
