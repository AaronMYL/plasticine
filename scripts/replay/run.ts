// 回放一件（内核优化第三批，11-17）：用这条线现在的系统提示和工具面，加上当时那一句话和它前面的一段，问一次真模型，
// 看它先调什么。
// 不执行任何工具（不点网页、不跑命令、不发消息）；只有「找工具」这一类（tool_search）照常执行再问一次，最多三问。
// 只记工具名和 token 数，不记模型写的正文。

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { createInitialSystemMessage, toToolDeclaration, type Api, type AssistantMessage, type Context,
  type Message, type Model } from '@earendil-works/pi-ai';
import { DISCOVERY_TOOLS, callName, judge, type CaseMatch } from './families.ts';
import type { ReplayCase } from './cases.ts';

export const MAX_ASKS = 3;

export interface ReplayModel {
  model: Model<Api>;
  complete(context: Context, signal: AbortSignal): Promise<AssistantMessage>;
}

export interface ReplayPreview {
  prompt: string;
  /** 一开始声明给模型的。 */
  tools: AgentTool[];
  /** 能执行的全部（内核优化第四批：其余的 tool_search 找到以后才声明）；不给就是 tools。 */
  all?: AgentTool[];
}

export interface CaseResult {
  ref: string;
  kind: string;
  expected: string[];
  got: string[];
  match: CaseMatch;
  asks: number;
  /** 第一次请求的提示词 token（input + 缓存命中）。 */
  firstPrompt: number;
  /** 几次请求加起来。 */
  totalPrompt: number;
  output: number;
  error: string | null;
}

function promptTokens(message: AssistantMessage): number {
  return message.usage.input + message.usage.cacheRead;
}

function toolCalls(message: AssistantMessage) {
  return message.content.flatMap((part) => (part.type === 'toolCall' ? [part] : []));
}

function loadedNames(details: unknown): string[] {
  const loaded: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'loaded') : undefined;
  return Array.isArray(loaded) ? loaded.filter((name): name is string => typeof name === 'string') : [];
}

/** 找工具的那几次照常执行，结果接在后面；找到的工具照内核的样子在结果后面声明，再问。 */
async function discover(preview: ReplayPreview, message: AssistantMessage, declared: Set<string>,
  signal: AbortSignal): Promise<Message[]> {
  const all = preview.all ?? preview.tools;
  const results: Message[] = [];
  const added: AgentTool[] = [];
  for (const call of toolCalls(message)) {
    const tool = all.find((item) => item.name === call.name);
    const result = tool === undefined ? { content: [{ type: 'text' as const, text: '没有这件工具' }], details: {} }
      : await tool.execute(call.id, call.arguments, signal);
    results.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content,
      isError: tool === undefined, timestamp: Date.now() });
    for (const name of loadedNames(result.details)) {
      const found = all.find((item) => item.name === name);
      if (found !== undefined && !declared.has(name)) {
        declared.add(name);
        added.push(found);
      }
    }
  }
  return added.length === 0 ? results
    : [...results, { role: 'system', content: '', toolsAdded: added.map(toToolDeclaration), timestamp: Date.now() }];
}

export async function replayCase(item: ReplayCase, preview: ReplayPreview, opening: readonly Message[],
  model: ReplayModel, signal: AbortSignal): Promise<CaseResult> {
  const system = createInitialSystemMessage(preview.prompt, preview.tools.map(toToolDeclaration));
  const messages: AgentMessage[] = [...(system === undefined ? [] : [system]), ...opening];
  const declared = new Set(preview.tools.map((tool) => tool.name));
  const result: CaseResult = { ref: item.ref, kind: item.kind, expected: item.expected, got: [], match: 'none',
    asks: 0, firstPrompt: 0, totalPrompt: 0, output: 0, error: null };
  try {
    for (let ask = 0; ask < MAX_ASKS; ask += 1) {
      const answer = await model.complete({ messages: messages as Message[] }, signal);
      result.asks += 1;
      result.firstPrompt = ask === 0 ? promptTokens(answer) : result.firstPrompt;
      result.totalPrompt += promptTokens(answer);
      result.output += answer.usage.output;
      if (answer.stopReason === 'error' || answer.stopReason === 'aborted') {
        result.error = answer.errorMessage ?? answer.stopReason;
        return result;
      }
      const calls = toolCalls(answer);
      const real = calls.filter((call) => !DISCOVERY_TOOLS.has(call.name));
      if (real.length > 0 || calls.length === 0) {
        result.got = real.map((call) => callName(call.name, call.arguments));
        result.match = judge(item.expected, result.got);
        return result;
      }
      messages.push(answer, ...await discover(preview, answer, declared, signal));
    }
    result.error = `问了 ${MAX_ASKS} 次都只在找工具`;
  } catch (error) {
    result.error = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  }
  return result;
}

export interface ReplaySummary {
  cases: number;
  exact: number;
  family: number;
  none: number;
  errors: number;
  avgFirstPrompt: number;
  avgTotalPrompt: number;
  avgAsks: number;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarize(results: readonly CaseResult[]): ReplaySummary {
  const ok = results.filter((result) => result.error === null);
  return {
    cases: results.length,
    exact: ok.filter((result) => result.match === 'exact').length,
    family: ok.filter((result) => result.match === 'family').length,
    none: ok.filter((result) => result.match === 'none').length,
    errors: results.length - ok.length,
    avgFirstPrompt: average(ok.map((result) => result.firstPrompt)),
    avgTotalPrompt: average(ok.map((result) => result.totalPrompt)),
    avgAsks: average(ok.map((result) => result.asks * 100)) / 100,
  };
}
