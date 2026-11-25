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
  purposes: string[];
  respond(steps: FauxResponseStep[]): void;
  close(): Promise<void>;
}

export interface HarnessOptions {
  tools?: KernelTool[];
  noModel?: boolean;
  handle?: TestState;
  extra?: Partial<KernelOptions>;
  vision?: boolean;
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
