import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { estimateTokens as textTokens } from '../tools/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import { contextWindow, MAX_DAY_COMPACTIONS, saveCompaction } from './day-context.ts';
import { answerText, contentText, convertToLlm, isAssistant } from './messages.ts';
import type { ModelChoice, ModelSource } from './types.ts';

export const COMPACTION_RESERVE_TOKENS = 16_384;
export const COMPACTION_KEEP_RECENT_TOKENS = 20_000;
export const COMPACTION_WORK_BUDGET_TOKENS = 100_000;
export const COMPACTION_HEADROOM_TOKENS = 8_192;
const TOOL_RESULT_CHARS = 2_000;

const SUMMARY_SYSTEM = '你是上下文整理助手：读一段用户和 AI 的对话，按给定格式写成结构化的摘要，'
  + '给接着做事的另一个 AI 看。不要接着对话，不要回答对话里的问题，只输出摘要。';

const SUMMARY_FORMAT = `按这个格式写（中文；每段简短；文件路径、名字、错误原文、数字照抄）：

## 目标
[他要做成什么；有几件就写几件]

## 他的要求和偏好
- [他说过的约束、偏好；没有写「（无）」]

## 进度
### 做完了
- [x] [做完的事]
### 正在做
- [ ] [手上的事]
### 卡住了
- [卡在哪；没有就不写]

## 定下的事
- **[决定]**：[一句理由]

## 下一步
1. [按顺序]

## 要紧的细节
- [接着做需要的数据、引用；没有写「（无）」]`;

const UPDATE_RULES = '把下面新的对话并进 <previous-summary> 里已有的摘要：已有的信息都留着，新的进度、决定、细节加进去，'
  + '做完的从「正在做」挪到「做完了」，「下一步」按现在的情况改。';

export type CompactionState = Pick<StateService, 'lines' | 'lineDays' | 'lineMessages'>;

export function messageTokens(message: AgentMessage): number {
  if (message.role === 'system') {
    const tools = message.toolsAdded === undefined ? '' : JSON.stringify(message.toolsAdded);
    return textTokens(`${contentText(message.content)}${tools}`);
  }
  if (message.role === 'assistant') {
    const parts = message.content.map((part) => {
      if (part.type === 'text') {
        return part.text;
      }
      return part.type === 'thinking' ? part.thinking : `${part.name}${JSON.stringify(part.arguments)}`;
    });
    return textTokens(parts.join(''));
  }
  if (message.role === 'lineReport' || message.role === 'notice' || message.role === 'welcome'
    || message.role === 'letter' || message.role === 'handoff') {
    return textTokens(message.text);
  }
  if (message.role === 'lineSummary') {
    return textTokens(message.summary);
  }
  return textTokens(contentText(message.content));
}

export function contextTokens(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistant(message) && message.stopReason !== 'error' && message.stopReason !== 'aborted'
      && message.usage.totalTokens > 0) {
      return message.usage.totalTokens + messages.slice(index + 1).reduce((sum, next) => sum + messageTokens(next), 0);
    }
  }
  return messages.reduce((sum, message) => sum + messageTokens(message), 0);
}

function cutPoint(message: AgentMessage): boolean {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'lineReport'
    || message.role === 'notice' || message.role === 'welcome' || message.role === 'letter'
    || message.role === 'handoff';
}

export function findCut(history: readonly AgentMessage[], keep: number): number {
  let kept = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    kept += messageTokens(history[index] as AgentMessage);
    if (kept >= keep) {
      for (let cut = index; cut < history.length; cut += 1) {
        if (cutPoint(history[cut] as AgentMessage)) {
          return cut;
        }
      }
      return index;
    }
  }
  return 0;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（后面省略）`;
}

export function serializeForSummary(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      parts.push(`[用户]：${contentText(message.content)}`);
    } else if (message.role === 'assistant') {
      const text = answerText(message);
      if (text !== '') {
        parts.push(`[AI]：${text}`);
      }
      const calls = message.content.flatMap((part) => (part.type === 'toolCall'
        ? [`${part.name}(${JSON.stringify(part.arguments)})`] : []));
      if (calls.length > 0) {
        parts.push(`[AI 调用工具]：${calls.join('；')}`);
      }
    } else if (message.role === 'toolResult') {
      parts.push(`[工具结果]：${clip(contentText(message.content), TOOL_RESULT_CHARS)}`);
    }
  }
  return parts.join('\n\n');
}

export async function summarize(models: ModelSource, choice: ModelChoice, messages: AgentMessage[],
  previous: string | null, signal?: AbortSignal): Promise<string> {
  const chars = Array.from(serializeForSummary(convertToLlm(messages)));
  const maxTokens = Math.min(COMPACTION_RESERVE_TOKENS, choice.model.maxTokens,
    Math.floor(choice.model.contextWindow / 4));
  let summary = previous ?? '';
  let cursor = 0;
  do {
    signal?.throwIfAborted();
    const prefix = summary.trim() === '' ? ''
      : `<previous-summary>\n${summary}\n</previous-summary>\n\n${UPDATE_RULES}\n\n`;
    const overhead = textTokens(`${SUMMARY_SYSTEM}${SUMMARY_FORMAT}${prefix}<conversation></conversation>`);
    const budget = choice.model.contextWindow - maxTokens - overhead - 1024;
    if (budget < 1) throw new Error('摘要模型的上下文窗口装不下现有摘要，请在 AI 设置中选择更大窗口的模型。');
    const size = Math.max(1, Math.floor(budget * 3 / 4));
    const chunk = chars.slice(cursor, cursor + size).join('');
    cursor += size;
    const prompt = `<conversation>\n${chunk}\n</conversation>\n\n${prefix}${SUMMARY_FORMAT}`;
    const response = await models.complete(choice.model, { systemPrompt: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, {
      ...(signal === undefined ? {} : { signal }), reasoning: choice.thinking, maxTokens,
      usage: { purpose: 'compaction' },
    });
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(`写摘要没成：${response.errorMessage ?? response.stopReason}`);
    }
    if (response.stopReason === 'length') throw new Error('写摘要没成：摘要太长被截断了');
    summary = answerText(response);
    if (summary === '') throw new Error('写摘要没成：模型没有写出摘要');
  } while (cursor < chars.length);
  return summary;
}

export function compactionThreshold(window: number, reserve: number, keep: number, fixed: number): number {
  const target = Math.min(Math.floor(window / 2), COMPACTION_WORK_BUDGET_TOKENS);
  return Math.min(window - reserve, Math.max(target, fixed + keep + COMPACTION_HEADROOM_TOKENS));
}

export interface CompactorDeps {
  state: CompactionState;
  models: ModelSource;
  now: () => Date;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export function createCompactor(deps: CompactorDeps) {
  const reserve = deps.reserveTokens ?? COMPACTION_RESERVE_TOKENS;
  const keep = deps.keepRecentTokens ?? COMPACTION_KEEP_RECENT_TOKENS;
  return async (line: LineRow, messages: AgentMessage[], seqOf: (message: AgentMessage) => number | undefined,
    choice: ModelChoice, options: { force: boolean; signal?: AbortSignal }): Promise<AgentMessage[]> => {
    const window = choice.model.contextWindow;
    const head = messages.filter((message) => message.role === 'system');
    const fixed = head.reduce((sum, message) => sum + messageTokens(message), 0);
    if (!options.force && (window <= 0
      || contextTokens(messages) <= compactionThreshold(window, reserve, keep, fixed))) {
      return messages;
    }
    const history = messages.filter((message) => message.role !== 'system' && message.role !== 'lineSummary');
    const cut = findCut(history, options.force ? Math.min(keep, Math.floor(window / 4)) : keep);
    const kept = history.slice(cut);
    const firstKept = kept[0] === undefined ? undefined : seqOf(kept[0]);
    if (cut === 0 || firstKept === undefined) {
      return messages;
    }
    const context = contextWindow(deps.state, line);
    const summaryOf = (summary: string | null): AgentMessage[] => (summary === null ? []
      : [{ role: 'lineSummary', summary, timestamp: deps.now().getTime() }]);
    if (context.day !== null && context.day.compactions >= MAX_DAY_COMPACTIONS) {
      saveCompaction(deps.state, line, context, context.summary, firstKept - 1, false);
      return [...head, ...summaryOf(context.summary), ...kept];
    }
    try {
      const summaryChoice = deps.models.current('compaction');
      if (summaryChoice === undefined) throw new Error('还没有连接对话历史压缩用的模型。');
      const summary = await summarize(deps.models, summaryChoice, history.slice(0, cut), context.summary,
        options.signal);
      saveCompaction(deps.state, line, context, summary, firstKept - 1, true);
      return [...head, ...summaryOf(summary), ...kept];
    } catch (error) {
      safeLog('warn', 'line_compaction_failed', { category: errorCategory(error) });
      return messages;
    }
  };
}
