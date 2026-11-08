// 做梦读什么（《优化清单》第 10 条夜里那一半；参考 Anthropic Cookbook《Dreaming with a Dynamic Workflow》）：把这段时间的
// 线（主线、旁聊、后台线、心跳开的线、和朋友及朋友的 AI 的往来）导成纯文字，加上「今天的记录」。他说的话带出处
// （line:<线>:<seq>），可以写进记忆；Plasticine 说的、工具结果、网页、邮件、朋友的话只当资料，只能拿来提推断。

import type { MemoryAnchor, MemoryJournalEntry } from '../../shared/state.ts';
import { plainText, type LineMessageRow, type StateService } from '../state/index.ts';
import type { CurationSource } from './memory-curation-ops.ts';

/** 一段对话里一条消息最多给这么多字：长的工具结果、网页只要个大概。 */
const MESSAGE_CHARS = 1_500;
const TOOL_CHARS = 300;
/** 一轮最多读这么多字的对话（便宜模型一次读得完）；多出来的分到下一轮。 */
export const ROUND_CHARS = 30_000;
/** 一晚最多几轮（省钱：少走几轮）；读不完的留到下一晚。 */
export const MAX_ROUNDS = 3;

export type TranscriptState = Pick<StateService, 'lineMessages' | 'lines'>;

export interface Transcript {
  lineId: string;
  text: string;
  /** 这段里他说的话（能当事实的出处）。 */
  said: string[];
  /** 这段里别的消息（只能当推断的出处）。 */
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

/** 这段时间写下的全部消息，按线导成纯文字。 */
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

/** 分轮：互不相干的几条线放进同一轮，每轮不超过 ROUND_CHARS 字。 */
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

/** 这一轮能引用的出处：他说的话、今天的记录（都算他说的）；别的消息只能拿来提推断。 */
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
