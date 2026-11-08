// 线内核的测试装配：临时 SQLite、pi-ai 的假模型（不联网、不用真模型）、手拨的钟、收集推给客户端的事件。

import { createModels, fauxAssistantMessage, fauxProvider, type FauxProviderHandle, type FauxResponseFactory,
  type FauxResponseStep, type TranscriptContext } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { LineStreamEvent } from '../../shared/api/lines.ts';
import { AskDesk, Presenter, routeAsks } from '../../src/attention/index.ts';
import { checkedArgs, LineKernel, type KernelOptions, type KernelTool, type Later, type ModelSource }
  from '../../src/lines/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

export interface ManualClock {
  now: () => Date;
  later: Later;
  /** 往前拨 ms，到点的定时按时间先后跑。 */
  advance(ms: number): void;
  pending(): number;
}

export function manualClock(start = Date.parse('2026-11-05T08:00:00.000Z')): ManualClock {
  let current = start;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => new Date(current),
    later: (ms, run) => {
      next += 1;
      const id = next;
      timers.set(id, { at: current + ms, run });
      return () => {
        timers.delete(id);
      };
    },
    advance(ms) {
      current += ms;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= current)
        .sort(([, a], [, b]) => a.at - b.at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.run();
      }
    },
    pending: () => timers.size,
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 回声：最简单的工具；say 用参数写一句大白话。 */
export function echoTool(): KernelTool {
  const parameters = Type.Object({ text: Type.String() }, { additionalProperties: false });
  return {
    name: 'echo',
    say: (args) => `回声：${String(args['text'] ?? '')}`,
    hardLine: () => null,
    create: () => ({
      name: 'echo', label: '回声', description: '把 text 原样回给你', parameters,
      execute: async (_id, raw) => {
        const params = checkedArgs(parameters, raw, 'echo');
        return { content: [{ type: 'text', text: `回声：${params.text}` }], details: {} };
      },
    }),
  };
}

/** 慢工具：等测试放行才回（叫停时不再等）；用来让线停在「在跑」。started 在它开始做时记一笔。 */
export function slowTool(gate: () => Promise<string>, started: string[] = []): KernelTool {
  const parameters = Type.Object({ what: Type.String() }, { additionalProperties: false });
  return {
    name: 'slow',
    say: (args) => `慢慢做：${String(args['what'] ?? '')}`,
    hardLine: () => null,
    create: () => ({
      name: 'slow', label: '慢', description: '慢慢做', parameters,
      execute: async (_id, raw, signal) => {
        started.push(checkedArgs(parameters, raw, 'slow').what);
        const aborted = new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('叫停了')), { once: true });
        });
        return { content: [{ type: 'text', text: await Promise.race([gate(), aborted]) }], details: {} };
      },
    }),
  };
}

/** 发信：硬线（以他名义对外发出）。记下真的执行了几次。 */
export function mailTool(sent: string[]): KernelTool {
  const parameters = Type.Object({ to: Type.String(), body: Type.String() }, { additionalProperties: false });
  return {
    name: 'send_mail',
    say: (args) => `把这封回复发给 ${String(args['to'] ?? '')}`,
    hardLine: () => 'outward',
    consequence: () => '发出后对方会收到，撤不回。',
    approveLabel: () => '发出',
    create: () => ({
      name: 'send_mail', label: '发信', description: '发一封信', parameters,
      execute: async (_id, raw) => {
        const params = checkedArgs(parameters, raw, 'send_mail');
        sent.push(`${params.to}:${params.body}`);
        return { content: [{ type: 'text', text: '已发出' }], details: {} };
      },
    }),
  };
}

export interface Harness {
  handle: TestState;
  kernel: LineKernel;
  desk: AskDesk;
  faux: FauxProviderHandle;
  events: LineStreamEvent[];
  clock: ManualClock;
  /** 每次取模型时要的用途（主线 main、旁聊 side、后台线 agent、压缩 compaction）。 */
  purposes: string[];
  respond(steps: FauxResponseStep[]): void;
  close(): Promise<void>;
}

export interface HarnessOptions {
  tools?: KernelTool[];
  /** 没有模型（还没连接任何提供商）。 */
  noModel?: boolean;
  /** 接着用一个已有的库（重启）。 */
  handle?: TestState;
  extra?: Partial<KernelOptions>;
  /** 假模型能不能看图（input 带不带 image）；不给就是 pi-ai 假模型的默认。 */
  vision?: boolean;
  /** 压缩（第四级）：拿到这个装配的模型来源和库，造一个压缩器。 */
  compact?: (source: ModelSource, state: TestState['state'], now: () => Date) => KernelOptions['compact'];
}

export async function startKernel(options: HarnessOptions = {}): Promise<Harness> {
  const handle = options.handle ?? await openTestState();
  const { state } = handle;
  const clock = manualClock();
  const desk = new AskDesk({ state, presenter: new Presenter(state), now: clock.now });
  const faux = fauxProvider(options.vision === undefined ? undefined
    : { models: [{ id: 'faux-model', input: options.vision ? ['text', 'image'] : ['text'] }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const purposes: string[] = [];
  const source: ModelSource = {
    current: (purpose) => {
      purposes.push(purpose ?? 'main');
      return options.noModel === true ? undefined : { model: faux.getModel(), thinking: 'off' };
    },
    streamFn: models.streamSimple.bind(models),
    complete: (model, context, options) => models.completeSimple(model, context, { ...options?.signal === undefined
      ? {} : { signal: options.signal } }),
  };
  const events: LineStreamEvent[] = [];
  const compact = options.compact?.(source, state, clock.now);
  const kernel = new LineKernel({ state, desk, models: source, publish: (event) => events.push(event),
    tools: options.tools ?? [], now: clock.now, later: clock.later, ...(compact === undefined ? {} : { compact }),
    ...options.extra });
  desk.setResolver(routeAsks(kernel.resolvers(), { resolve: () => undefined }));
  kernel.start();
  return {
    handle, kernel, desk, faux, events, clock, purposes,
    respond: (steps) => faux.appendResponses(steps),
    async close() {
      await kernel.stop();
      await handle.cleanup();
    },
  };
}

/** 等到条件成立（事件、库里的状态由异步的一轮写出来）。 */
export async function until(check: () => boolean, what: string, tries = 500): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`等不到：${what}`);
}

export function systemText(context: TranscriptContext): string {
  const system = context.messages.find((message) => message.role === 'system');
  if (system === undefined || system.role !== 'system') {
    return '';
  }
  return typeof system.content === 'string' ? system.content : system.content.map((part) => part.text).join('');
}

/**
 * 几条线同时跑时按线分剧本：每次请求看系统提示里有哪个关键字（主对话是「这是主对话」，后台线是它的标题），
 * 从那条线自己的剧本里取下一步。剧本用完就答一个错，测试会看出来。
 */
export function scriptByLine(h: Harness, script: Record<string, FauxResponseStep[]>, requests = 40): void {
  const queues = new Map(Object.entries(script).map(([key, steps]) => [key, [...steps]]));
  const step: FauxResponseFactory = (context, options, state, model) => {
    const text = systemText(context);
    const key = [...queues.keys()].find((candidate) => text.includes(candidate));
    const next = key === undefined ? undefined : queues.get(key)?.shift();
    if (next === undefined) {
      return fauxAssistantMessage('', { stopReason: 'error', errorMessage: `剧本里没有这一步：${key ?? '未知的线'}` });
    }
    return typeof next === 'function' ? next(context, options, state, model) : next;
  };
  h.respond(Array.from({ length: requests }, () => step));
}
