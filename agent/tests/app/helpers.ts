// Test harness for app/: a real service on a random loopback port over a temporary state directory, with fake models
// (no network beyond 127.0.0.1, no real model) and a clock tests can move. 线（主对话、后台线）走 pi-ai 的假提供商，
// 用 respond() 给它剧本；旁路的模型调用（笔记、翻译、信息流…）走 scriptedText，剧本是 startTestApp 的第一个参数。

import { createModels, fauxProvider, type FauxProviderHandle, type FauxResponseStep } from '@earendil-works/pi-ai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HubStreamEvent } from '../../shared/api/index.ts';
import {
  generateVapidKeys,
  type PushRequest,
  type PushTransport,
  type VapidKeys,
} from '../../src/attention/index.ts';
import type { Tool } from '../../src/brain/tools/registry.ts';
import type { NodeTransport } from '../../src/devices/index.ts';
import type { App } from '../../src/app/app.ts';
import { assembleApp, type AssembleOptions } from '../../src/app/assemble.ts';
import type { CloudTransports } from '../../src/cloud-tools/index.ts';
import type { MailImageFetchOptions } from '../../src/cloud-tools/mail-image-fetch.ts';
import type { FaviconFetchOptions } from '../../src/cloud-tools/favicon-fetch.ts';
import type { FeedFetcher } from '../../src/daily/index.ts';
import { SESSION_COOKIE } from '../../src/app/config.ts';
import { hashPassword } from '../../src/app/password-hash.ts';
import { TextModelError, type TextAnswer } from '../../src/kernel/index.ts';
import type { ModelSource } from '../../src/lines/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';
import { scriptedText, type TextStep } from '../brain/helpers.ts';

export const START_MS = Date.parse('2026-10-27T08:00:00.000Z');

export interface TestClock {
  now: () => Date;
  advance(ms: number): void;
}

/** Moves only when told, plus one millisecond per reading so stored times are distinct and ordered. */
export function testClock(): TestClock {
  let current = START_MS;
  return {
    now: () => {
      current += 1;
      return new Date(current);
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

/** One request the service sent to a push service (none leaves the test: the transport is this fake). */
export interface SentPush {
  endpoint: string;
  request: PushRequest;
}

export interface TestApp {
  app: App;
  state: StateService;
  clock: TestClock;
  base: string;
  directory: string;
  /** What the scripted text model was asked, in order. */
  requests: ReturnType<typeof scriptedText>['requests'];
  /** 线用的假提供商。 */
  faux: FauxProviderHandle;
  /** 给线的下几轮排剧本。 */
  respond(steps: FauxResponseStep[]): void;
  /** Web Push requests, in order. */
  pushes: SentPush[];
  vapidKeys: VapidKeys;
  /** `keepDirectory`: leave the state directory for a restart over the same library. */
  close(keepDirectory?: boolean): Promise<void>;
}

export interface TestAppOptions {
  feedFetcher?: FeedFetcher;
  automaticBackups?: boolean;
  /** 记忆整理（默认关，免得脚本模型多收请求）。 */
  memoryCuration?: boolean;
  extraTools?: Tool[];
  sseHeartbeatMs?: number;
  /** 起后台的定时与扫描（默认 true）。 */
  startTasks?: boolean;
  /** Status the fake push service answers with. */
  pushStatus?: number;
  /** 内置技能目录（不给就用默认的 agent/builtin-skills，现在没有）。 */
  builtinSkills?: string;
  /** An existing state directory (a restart over the same library). */
  directory?: string;
  /** How device actions reach nodes (a fake). */
  nodeTransport?: NodeTransport;
  /** M5 乙路: fake outside services for the cloud tools (none leaves the test). */
  cloudTransports?: Partial<CloudTransports>;
  /** 邮件图片代理的解析和核地址（测试给固定表）。 */
  mailImages?: MailImageFetchOptions;
  favicons?: FaviconFetchOptions;
  /** The development dry run (default on, as in the service until it is switched on). */
  dryRun?: boolean;
  /** 第 113 条：网络那一头；测试默认不自己收发（autoSync false）、不调分身的模型（proxy false）。 */
  network?: AssembleOptions['network'];
  /** 线的装配：不给就用假提供商；给了就整个换掉（工具、压缩、并发）。 */
  lines?: Partial<AssembleOptions['lines']>;
  /** 没有连接任何模型（线和旁路都答「没有可用的模型」）。 */
  noModel?: boolean;
  /** 新内核的模型连接（不给就不装）：拿到这个服务的库再造。 */
  kernelModels?: (state: StateService) => NonNullable<AssembleOptions['kernelModels']>;
  /** 桌面客户端给本体的本机令牌（PLASTICINE_LOCAL_TOKEN）；不给 = 没设，本机令牌一律不认。 */
  localToken?: string;
}

// Ticks only when woken in tests, so a test sees exactly the work it started.
const TEST_TICK_MS = 60_000;

function fauxSource(noModel: boolean): { source: ModelSource; faux: FauxProviderHandle } {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => (noModel ? undefined : { model: faux.getModel(), thinking: 'off' }),
    streamFn: models.streamSimple.bind(models),
    complete: (model, context, options) => models.completeSimple(model, context,
      options?.signal === undefined ? {} : { signal: options.signal }),
  };
  return { source, faux };
}

export async function startTestApp(steps: TextStep[] = [], options: TestAppOptions = {}): Promise<TestApp> {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), 'plasticine-app-')));
  const clock = testClock();
  const state = openState({ path: join(directory, 'plasticine.sqlite'), now: () => clock.now().toISOString() });
  const noModel = options.noModel === true;
  const text = scriptedText(noModel ? [new TextModelError('no_model', '还没有连接模型')] : steps);
  const { source, faux } = fauxSource(noModel);
  const pushes: SentPush[] = [];
  const pushTransport: PushTransport = async (endpoint, request) => {
    pushes.push({ endpoint, request });
    return { status: options.pushStatus ?? 201 };
  };
  const vapidKeys = generateVapidKeys();
  const app = assembleApp({
    state,
    text: text.models,
    memoryCuration: options.memoryCuration ?? false,
    automaticBackups: options.automaticBackups ?? false,
    dryRun: options.dryRun ?? true,
    ...(options.builtinSkills === undefined ? {} : { builtinSkills: options.builtinSkills }),
    ...(options.feedFetcher === undefined ? {} : { feedFetcher: options.feedFetcher }),
    ...(options.cloudTransports === undefined ? {} : { cloudTransports: options.cloudTransports }),
    ...(options.mailImages === undefined ? {} : { mailImages: options.mailImages }),
    ...(options.favicons === undefined ? {} : { favicons: options.favicons }),
    vapidKeys,
    vapidSubject: 'https://plasticine.test',
    pushTransport,
    now: clock.now,
    ...(options.extraTools === undefined ? {} : { extraTools: options.extraTools }),
    ...(options.sseHeartbeatMs === undefined ? {} : { sseHeartbeatMs: options.sseHeartbeatMs }),
    scanTickMs: TEST_TICK_MS,
    stateDirectory: directory,
    ...(options.nodeTransport === undefined ? {} : { nodeTransport: options.nodeTransport }),
    network: { autoSync: false, responder: false, ...options.network },
    lines: { models: source, ...options.lines },
    ...(options.kernelModels === undefined ? {} : { kernelModels: options.kernelModels(state) }),
    localToken: options.localToken ?? null,
  });
  if (options.startTasks !== false) {
    app.start();
  }
  const port = await app.listen(0);
  let closed = false;
  return {
    app,
    state,
    clock,
    base: `http://127.0.0.1:${port}`,
    directory,
    requests: text.requests,
    faux,
    respond: (next) => faux.appendResponses(next),
    pushes,
    vapidKeys,
    async close(keepDirectory = false) {
      if (closed) {
        return;
      }
      closed = true;
      await app.stop(1_000);
      state.close();
      if (!keepDirectory) {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export interface ApiReply {
  status: number;
  headers: Headers;
  body: unknown;
}

export async function call(
  t: TestApp,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<ApiReply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie !== undefined) {
    headers['cookie'] = options.cookie;
  }
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${t.base}${path}`, init);
  const type = response.headers.get('content-type') ?? '';
  const body: unknown = type.startsWith('application/json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, headers: response.headers, body };
}

/** Narrows an untyped JSON body for assertions; the shared schemas check the real shapes elsewhere. */
export function json(reply: ApiReply): Record<string, unknown> {
  if (typeof reply.body !== 'object' || reply.body === null || Array.isArray(reply.body)) {
    throw new Error(`响应体不是 JSON 对象（${reply.status}）`);
  }
  return reply.body as Record<string, unknown>;
}

/** `plasticine_session=<token>` from a Set-Cookie header, ready to send back. */
export function cookieFrom(reply: ApiReply): string {
  const header = reply.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
  if (match === null || match[1] === undefined || match[1] === '') {
    throw new Error(`响应里没有会话 cookie：${header}`);
  }
  return `${SESSION_COOKIE}=${match[1]}`;
}

/** 测试用的主人密码：明显是假的。 */
export const TEST_PASSWORD = 'fake-test-password';

/**
 * 登记一台新设备并返回它的 cookie（2026-11-08 起用密码登录，配对码下掉了）：还没设密码就先替主人设上测试密码，
 * 再走 POST /v2/session/password。
 */
export async function pair(t: TestApp, deviceName = '测试手机'): Promise<string> {
  if (t.state.ownerAccount.credentials() === null) {
    const { hash, salt } = await hashPassword(TEST_PASSWORD);
    t.state.ownerAccount.setPassword(hash, salt, t.clock.now().toISOString());
  }
  const reply = await call(t, 'POST', '/v2/session/password', { body: { password: TEST_PASSWORD, deviceName } });
  if (reply.status !== 201) {
    throw new Error(`登录失败：${reply.status} ${JSON.stringify(reply.body)}`);
  }
  return cookieFrom(reply);
}

export interface SseFrame {
  id: string | null;
  event: HubStreamEvent;
}

export interface SseStream {
  /** The next event (optionally of one type), waiting at most `timeoutMs`. */
  next(type?: HubStreamEvent['type'], timeoutMs?: number): Promise<SseFrame>;
  close(): void;
}

const SSE_WAIT_MS = 5_000;

function parseFrame(block: string): SseFrame | undefined {
  let id: string | null = null;
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('id: ')) {
      id = line.slice('id: '.length);
    } else if (line.startsWith('data: ')) {
      data += line.slice('data: '.length);
    }
  }
  if (data === '') {
    return undefined;
  }
  return { id, event: JSON.parse(data) as HubStreamEvent };
}

export async function openEvents(t: TestApp, cookie: string, lastEventId?: string): Promise<SseStream> {
  const controller = new AbortController();
  const headers: Record<string, string> = { cookie };
  if (lastEventId !== undefined) {
    headers['last-event-id'] = lastEventId;
  }
  const response = await fetch(`${t.base}/v2/events`, { headers, signal: controller.signal });
  if (response.status !== 200 || response.body === null) {
    throw new Error(`订阅失败：${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffered = '';

  async function pull(): Promise<void> {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error('事件流在等到想要的事件前就结束了');
    }
    buffered += decoder.decode(value, { stream: true });
    let end = buffered.indexOf('\n\n');
    while (end !== -1) {
      const frame = parseFrame(buffered.slice(0, end));
      buffered = buffered.slice(end + 2);
      if (frame !== undefined) {
        frames.push(frame);
      }
      end = buffered.indexOf('\n\n');
    }
  }

  // One read in flight at a time: a read left behind by a timeout is reused, so no chunk is lost.
  let inflight: Promise<void> | null = null;
  function pullOnce(): Promise<void> {
    inflight ??= pull().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function waitFor(work: Promise<void>, ms: number, what: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`等了 ${ms} 毫秒没等到 ${what}`)), ms);
    });
    try {
      await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function next(type?: HubStreamEvent['type'], timeoutMs = SSE_WAIT_MS): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = frames.findIndex((frame) => type === undefined || frame.event.type === type);
      const found = index === -1 ? undefined : frames.splice(0, index + 1).at(-1);
      if (found !== undefined) {
        return found;
      }
      await waitFor(pullOnce(), Math.max(1, deadline - Date.now()), type ?? '事件');
    }
  }

  return { next, close: () => controller.abort() };
}

/** 一步旁路模型调用：等 release() 才答，用来让它停在半路。叫停了就像真的提供商那样报错。 */
export function heldStep(answer: string): { step: TextStep; started: Promise<void>; release(): void } {
  let release = (): void => undefined;
  let markStarted = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const step = async (_request: unknown, signal: AbortSignal): Promise<TextAnswer> => {
    markStarted();
    const aborted = new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    await Promise.race([gate, aborted]);
    if (signal.aborted) {
      throw new TextModelError('failed', '叫停了');
    }
    return { text: answer, complete: true };
  };
  return { step, started, release: () => release() };
}
