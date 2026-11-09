// Fakes for the brain tests: a scripted text model (旁路的模型调用走 kernel/text.ts 的 TextModels；不联网、不用真模型),
// a real in-memory state library, and small tools whose every execution is counted, so a test can tell "reused" from
// "ran again".

import { Type, type TSchema } from 'typebox';
import type { ToolRole } from '../../shared/tools.ts';
import { defineTool, type Tool, type ToolContext, type ToolSpec } from '../../src/brain/tools/registry.ts';
import { TextModelError, type TextAnswer, type TextDeltas, type TextModels, type TextRequest }
  from '../../src/kernel/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';

export const ALL_ROLES: ToolRole[] = ['conversation', 'worker', 'verifier', 'diagnosis'];
/** Tools that write are never offered to the verifier. */
export const WRITER_ROLES: ToolRole[] = ['conversation', 'worker', 'diagnosis'];
export const FIXED_NOW = new Date('2026-10-27T08:00:00.000Z');

export function memoryState(): StateService {
  return openState({ path: ':memory:' });
}

/** 主对话那条线的 runId（工具上下文、回执、卡片都按它认）。 */
export const MAIN_RUN_ID = 'line:line-main';

const NoArgs = Type.Object({}, { additionalProperties: false });

type Overrides = Partial<Omit<ToolSpec<TSchema>, 'execute' | 'parameters'>>;

export interface CountingTool {
  tool: Tool;
  /** Times `execute` actually ran. */
  runs: () => number;
}

/** A tool that answers `reply` (default: its own name) after `delayMs`, honouring the abort signal. */
export function countingTool(name: string, overrides: Overrides = {}, behaviour: Behaviour = {}): CountingTool {
  let runs = 0;
  const writes = overrides.effect !== undefined && overrides.effect !== 'read';
  const tool = defineTool({
    name,
    label: `测试工具 ${name}`,
    description: `Test tool ${name}.`,
    replay: 'safe',
    effect: 'read',
    permission: 'auto',
    roles: writes ? WRITER_ROLES : ALL_ROLES,
    timeoutMs: 1_000,
    ...overrides,
    parameters: NoArgs,
    async execute(_args, context) {
      runs += 1;
      behaviour.onStart?.(name);
      await delay(behaviour.delayMs ?? 0, context.signal, behaviour.ignoreAbort === true);
      if (behaviour.fail !== undefined) {
        throw new Error(behaviour.fail);
      }
      behaviour.onEnd?.(name);
      return behaviour.reply ?? name;
    },
  });
  return { tool, runs: () => runs };
}

export interface Behaviour {
  delayMs?: number;
  reply?: string;
  fail?: string;
  /** Simulates a tool that never looks at its signal; dispatch must stop waiting anyway. */
  ignoreAbort?: boolean;
  onStart?: (name: string) => void;
  onEnd?: (name: string) => void;
}

function delay(ms: number, signal: AbortSignal, ignoreAbort: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      if (!ignoreAbort) {
        clearTimeout(timer);
        reject(signal.reason);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 剧本里的一步：一段文字（模型答的话）、一个 TextModelError（这次失败）、或者一个函数（自己看请求、自己决定答什么；
 * 要增量的调用会给第三个参数，函数可以自己一段段交）。
 */
export type TextStep = string | TextModelError
  | ((request: TextRequest, signal: AbortSignal, onText?: TextDeltas) => Promise<TextAnswer>);

/** 要增量时一段文字按这么多字一段交出去，段与段之间让出一轮事件循环，像真的模型那样陆续到。 */
const SCRIPTED_DELTA_CHARS = 4;

async function deliver(text: string, signal: AbortSignal, onText: TextDeltas): Promise<void> {
  for (let start = 0; start < text.length; start += SCRIPTED_DELTA_CHARS) {
    signal.throwIfAborted();
    onText(text.slice(start, start + SCRIPTED_DELTA_CHARS));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface ScriptedText {
  models: TextModels;
  /** 每次被问到的请求，按先后。 */
  requests: TextRequest[];
}

/** 每问一次取下一步；最后一步一直重复。没有剧本就答「没有可用的模型」。 */
export function scriptedText(steps: TextStep[]): ScriptedText {
  const requests: TextRequest[] = [];
  const models: TextModels = {
    async ask(request, signal, onText) {
      requests.push(structuredClone(request));
      const step = steps[Math.min(requests.length - 1, steps.length - 1)];
      if (step === undefined) {
        throw new TextModelError('no_model', '测试里没有给模型剧本');
      }
      if (step instanceof TextModelError) {
        throw step;
      }
      if (typeof step === 'function') {
        return step(request, signal, onText);
      }
      if (onText !== undefined) {
        await deliver(step, signal, onText);
      }
      return { text: step, complete: true };
    },
  };
  return { models, requests };
}

/** 一直等到请求被叫停，再像真的提供商那样报错。 */
export function hangUntilAborted(onStart?: () => void): TextStep {
  return async (_request, signal) => {
    onStart?.();
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    throw new TextModelError('failed', '叫停了');
  };
}

export const noSleep = async (): Promise<void> => undefined;

/** 直接调一件工具时给它的上下文：在主线上、这次调用的动作标识按 callId 拼。 */
export function toolContext(callId = 'call-1', overrides: Partial<ToolContext> = {}): ToolContext {
  return { signal: new AbortController().signal, runId: MAIN_RUN_ID, callId, actionId: `${MAIN_RUN_ID}:${callId}`,
    now: () => FIXED_NOW, ...overrides };
}
