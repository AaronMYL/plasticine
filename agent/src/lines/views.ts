// 线、排队消息给客户端看的样子（shared/api/lines.ts）。实时状态那一行只在内存里（跑着的那一轮知道自己在干什么）。

import type { LineMessageView, LineOutcome, LineView, QueuedMessageView } from '../../shared/api/lines.ts';
import type { LineMessageRow, LineRow, QueuedRow, StateService } from '../state/index.ts';
import { clip, isAssistant, messageView, type SayOf } from './messages.ts';
import { lineResult } from './results.ts';
import { unmetReason } from './verdict.ts';

// 后台线卡片上的结果预览：两三行。
const ANSWER_PREVIEW_CHARS = 280;

export interface Activity {
  text: string | null;
  since: string | null;
}

export const NO_ACTIVITY: Activity = { text: null, since: null };

export function queuedView(row: QueuedRow): QueuedMessageView {
  return { id: row.id, lineId: row.lineId, text: row.text, attachments: row.attachments, status: row.status,
    origin: row.origin, createdAt: row.createdAt };
}

export type ViewState = Pick<StateService, 'lineQueue' | 'lineMessages'>;

function outcome(state: ViewState, line: LineRow, queued: number): LineOutcome | null {
  if (line.status === 'failed') {
    return 'failed';
  }
  if (line.status === 'paused') {
    return line.pauseReason === 'user' ? 'stopped' : line.pauseReason === 'output_limit' ? 'incomplete' : null;
  }
  if (line.status !== 'idle' || queued > 0) {
    return null;
  }
  const last = state.lineMessages.last(line.id)?.message;
  if (!isAssistant(last)) {
    return null;
  }
  if (last.stopReason === 'length') {
    return 'incomplete';
  }
  if (last.stopReason === 'aborted') {
    return 'stopped';
  }
  return last.stopReason === 'stop' ? 'done' : null;
}

function lastAnswer(state: ViewState, lineId: string): string | null {
  const text = lineResult(state, lineId);
  return text === null ? null : clip(text, ANSWER_PREVIEW_CHARS);
}

function parentMessageSeq(state: ViewState, line: LineRow): number | null {
  if (line.parentLineId === null) return null;
  const first = state.lineMessages.first(line.id, 'user');
  const origin = first?.meta?.origin ?? state.lineQueue.queued(line.id)[0]?.origin;
  if (origin?.kind !== 'delegation' || origin.ref === undefined) return null;
  const source = state.lineMessages.said(origin.ref);
  return source?.lineId === line.parentLineId && source.role === 'assistant' ? source.seq : null;
}

export function lineView(state: ViewState, line: LineRow, activity: Activity): LineView {
  const queued = state.lineQueue.queued(line.id).length;
  const ended = outcome(state, line, queued);
  return {
    id: line.id,
    kind: line.kind,
    parentLineId: line.parentLineId,
    parentMessageSeq: parentMessageSeq(state, line),
    projectId: line.projectId,
    title: line.title,
    status: line.status,
    pauseReason: line.pauseReason,
    archivedAt: line.archivedAt,
    outcome: ended,
    pausedUntil: line.pausedUntil,
    failure: line.failure,
    activity: line.status === 'running' || line.status === 'waiting' ? activity.text : null,
    activeSince: line.status === 'running' || line.status === 'waiting' ? activity.since : null,
    queued,
    lastAnswer: lastAnswer(state, line.id),
    unmet: ended === 'done' ? unmetReason(state, line) : null,
    topic: line.topic,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

/** 一页消息给界面看的样子；工具结果配上它那次调用的大白话（调用在上一页时只写工具名）。 */
export function pageMessages(rows: readonly LineMessageRow[], sayOf: SayOf): LineMessageView[] {
  const args = new Map<string, unknown>();
  for (const row of rows) {
    if (isAssistant(row.message)) {
      for (const part of row.message.content) {
        if (part.type === 'toolCall') {
          args.set(part.id, part.arguments);
        }
      }
    }
  }
  return rows.map((row) => messageView(row, sayOf, (id) => args.get(id)));
}
