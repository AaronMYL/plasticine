// 一条线送给模型的上下文，全从库里装：系统提示（含工具声明）+ 压缩摘要 + 摘要之后的消息。主线和旁聊按天分段
// （day-context.ts）：摘要和起点都只看今天；大块的工具结果只放开头和引用（large-results.ts）。
// 还有两件跟库里消息形状有关的判断：末尾能不能接着跑、重启前是不是停在一组工具调用中间。

import type { AgentMessage, AgentTool, AgentToolCall } from '@earendil-works/pi-agent-core';
import { createInitialSystemMessage, toToolDeclaration, type AssistantMessage, type ToolResultMessage }
  from '@earendil-works/pi-ai';
import type { LineRow, StateService } from '../state/index.ts';
import { contextWindow } from './day-context.ts';
import { clipLargeResult } from './large-results.ts';
import { answerText, isAssistant, isToolResult } from './messages.ts';

export type TranscriptState = Pick<StateService, 'lines' | 'lineMessages' | 'lineDays'>;

/** 失败、被中止的回答不再送给模型（pi-ai 也会跳过它们）；末尾是这种回答时去掉，才能从它前面接着跑。 */
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

/** 末尾是用户的话、工具结果或贴回来的结果才接着跑；末尾是一段完整的回答说明这一轮已经做完。 */
export function continuable(messages: AgentMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role !== 'assistant' && last.role !== 'system';
}

export function buildTranscript(state: TranscriptState, line: LineRow, prompt: string, tools: readonly AgentTool[],
  seqOf: WeakMap<object, number>): AgentMessage[] {
  const system = createInitialSystemMessage(prompt, tools.map(toToolDeclaration));
  const head: AgentMessage[] = system === undefined ? [] : [system];
  const window = contextWindow(state, line);
  if (window.summary !== null && window.summary.trim() !== '') {
    head.push({ role: 'lineSummary', summary: window.summary, timestamp: 0 });
  }
  const history = state.lineMessages.after(line.id, window.after).flatMap((row) => {
    const stored = row.message as AgentMessage;
    const message = isToolResult(stored) ? clipLargeResult(stored, line.id, row.seq) : stored;
    // 他叫停时记下的空回答只给界面看（「停下了」），不送给模型。
    if (isAssistant(message) && message.stopReason === 'aborted' && answerText(message) === ''
      && !message.content.some((part) => part.type === 'toolCall')) {
      return [];
    }
    seqOf.set(message, row.seq);
    return [message];
  });
  return trimFailedTail([...head, ...history]);
}

export interface Dangling {
  assistant: AssistantMessage;
  calls: AgentToolCall[];
}

/** 库里最后是一段带工具调用的回答、后面只跟着其中一部分的结果：还没有结果的那几次调用。 */
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
