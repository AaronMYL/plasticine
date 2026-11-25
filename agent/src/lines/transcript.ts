import type { AgentMessage, AgentTool, AgentToolCall } from '@earendil-works/pi-agent-core';
import { createInitialSystemMessage, toToolDeclaration, type AssistantMessage, type ToolResultMessage }
  from '@earendil-works/pi-ai';
import type { LineMessageRow, LineRow, StateService } from '../state/index.ts';
import { contextWindow } from './day-context.ts';
import { clipLargeResult } from './large-results.ts';
import { answerText, isAssistant, isToolResult } from './messages.ts';
import { collapseStale, staleBoundary, type CallLike } from './stale-results.ts';
import { declareLoaded } from './tool-loadout.ts';

export type TranscriptState = Pick<StateService, 'lines' | 'lineMessages' | 'lineDays'>;

export function trimFailedTail(messages: AgentMessage[]): AgentMessage[] {
  let end = messages.length;
  while (end > 0) {
    const last = messages[end - 1];
    if (!isAssistant(last) || (last.stopReason !== 'error' && last.stopReason !== 'aborted')) {
      break;
    }
    end -= 1;
  }
  return messages.slice(0, end);
}

export function continuable(messages: AgentMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role !== 'assistant' && last.role !== 'system';
}

export function historyMessages(lineId: string, rows: readonly Pick<LineMessageRow, 'seq' | 'message'>[],
  seqOf: WeakMap<object, number> = new WeakMap()): AgentMessage[] {
  const boundary = staleBoundary(rows.at(-1)?.seq ?? 0);
  const calls = new Map<string, CallLike>();
  return rows.flatMap((row) => {
    const stored = row.message as AgentMessage;
    if (isAssistant(stored)) {
      for (const part of stored.content) {
        if (part.type === 'toolCall') {
          calls.set(part.id, part);
        }
      }
    }
    const message = isToolResult(stored)
      ? clipLargeResult(collapseStale(stored, calls.get(stored.toolCallId), row.seq, boundary), lineId, row.seq)
      : stored;
    if (isAssistant(message) && message.stopReason === 'aborted' && answerText(message) === ''
      && !message.content.some((part) => part.type === 'toolCall')) {
      return [];
    }
    seqOf.set(message, row.seq);
    return [message];
  });
}

export function buildTranscript(state: TranscriptState, line: LineRow, prompt: string, tools: readonly AgentTool[],
  seqOf: WeakMap<object, number>, deferred: ReadonlyMap<string, AgentTool> = new Map()): AgentMessage[] {
  const declared = tools.filter((tool) => !deferred.has(tool.name));
  const system = createInitialSystemMessage(prompt, declared.map(toToolDeclaration));
  const head: AgentMessage[] = system === undefined ? [] : [system];
  const window = contextWindow(state, line);
  if (window.summary !== null && window.summary.trim() !== '') {
    head.push({ role: 'lineSummary', summary: window.summary, timestamp: 0 });
  }
  const history = historyMessages(line.id, state.lineMessages.after(line.id, window.after), seqOf);
  return trimFailedTail([...head, ...declareLoaded(history, deferred)]);
}

export interface Dangling {
  assistant: AssistantMessage;
  calls: AgentToolCall[];
}

export function danglingCalls(state: TranscriptState, line: LineRow): Dangling | null {
  const rows = state.lineMessages.after(line.id, contextWindow(state, line).after);
  let index = rows.length - 1;
  while (index >= 0 && rows[index]?.role === 'toolResult') {
    index -= 1;
  }
  const head = rows[index]?.message;
  if (!isAssistant(head) || head.stopReason === 'error' || head.stopReason === 'aborted'
    || head.stopReason === 'length') {
    return null;
  }
  const answered = new Set(rows.slice(index + 1).map((row) => (row.message as ToolResultMessage).toolCallId));
  const calls = head.content.filter((part): part is AgentToolCall => part.type === 'toolCall'
    && !answered.has(part.id));
  return calls.length === 0 ? null : { assistant: head, calls };
}
