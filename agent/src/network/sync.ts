// 和中继的同步循环（规格第 3、5 节）：加入网络以后才跑。长轮询收信（每次最多等 25 秒）→ 验签解密入库 → 确认收到 →
// 推给界面 → 问题交给分身；发件箱另一条循环，按退避重试。出错记一句人话在 network_identity.last_error，退避后再来。
// 关着自动同步（测试）时两条循环都不起，由调用方 syncOnce / flush。

import type { NetworkIdentity } from '../../shared/state.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { requireIdentity, signerOf, type NetworkContext } from './context.ts';
import type { Inbound } from './inbound.ts';
import type { Outbox } from './outbox.ts';
import type { Responder } from './responder.ts';
import { RelayCallError } from './relay-client.ts';

/** 出错后的退避：2 秒起翻倍，最长一分钟。 */
const SYNC_RETRY_BASE_MS = 2_000;
const SYNC_RETRY_MAX_MS = 60_000;
/** 没加入网络、发件箱空着时多久看一眼（加入、发信会马上叫醒，不用等满）。 */
const IDLE_MS = 60_000;
/** 发件箱两轮之间至少隔一秒：一封信卡在异常里也不会空转。 */
const OUTBOX_MIN_GAP_MS = 1_000;

export interface SyncOptions {
  autoSync: boolean;
  /** 长轮询每次等多久（≤ 25 秒）。 */
  pollWaitSeconds: number;
  /** 一轮收信做完以后（交付补发这类）。 */
  afterSync?: () => void;
}

function sleep(ms: number, signal: AbortSignal, wake?: (resolve: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(ms, 0));
    signal.addEventListener('abort', done, { once: true });
    wake?.(done);
  });
}

function humanError(error: unknown): string {
  if (error instanceof RelayCallError) {
    return error.kind === 'refused' ? `中继拒绝了同步：${error.message}` : error.message;
  }
  return '同步时出错了，稍后自动再试。';
}

export class SyncLoop {
  readonly #context: NetworkContext;
  readonly #inbound: Inbound;
  readonly #outbox: Outbox;
  readonly #responder: Responder;
  readonly #options: SyncOptions;
  readonly #controller = new AbortController();
  readonly #loops: Promise<void>[] = [];
  #wakePoll: (() => void) | null = null;
  #wakeOutbox: (() => void) | null = null;
  #syncing: Promise<number> | null = null;

  constructor(context: NetworkContext, parts: { inbound: Inbound; outbox: Outbox; responder: Responder },
    options: SyncOptions) {
    this.#context = context;
    this.#inbound = parts.inbound;
    this.#outbox = parts.outbox;
    this.#responder = parts.responder;
    this.#options = options;
  }

  start(): void {
    if (!this.#options.autoSync || this.#loops.length > 0) {
      return;
    }
    this.#loops.push(this.#pollLoop(), this.#outboxLoop());
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await Promise.allSettled(this.#loops);
  }

  /** 加入网络了：收信那条马上开始。 */
  wake(): void {
    this.#wakePoll?.();
    this.#wakeOutbox?.();
  }

  /** 有信要发：发件箱马上发一轮。 */
  kick(): void {
    this.#wakeOutbox?.();
  }

  flush(): Promise<number> {
    return this.#outbox.flush(this.#controller.signal);
  }

  /** 收一轮信（同时只有一轮）；返回收到几封。 */
  syncOnce(waitSeconds = 0): Promise<number> {
    this.#syncing ??= this.#sync(waitSeconds).finally(() => {
      this.#syncing = null;
    });
    return this.#syncing;
  }

  async #sync(waitSeconds: number): Promise<number> {
    const { state, now } = this.#context;
    const identity = requireIdentity(this.#context);
    const signer = signerOf(identity);
    const relay = this.#context.relay();
    try {
      const reply = await relay.poll(signer, identity.cursor, waitSeconds, this.#controller.signal);
      const current = requireIdentity(this.#context);
      const outcome = await this.#inbound.receive(current, reply.envelopes);
      if (outcome.ackIds.length > 0) {
        await relay.ack(signer, outcome.ackIds);
      }
      const latest = requireIdentity(this.#context);
      state.networkIdentity.update(latest.version, { cursor: reply.cursor, lastSyncAt: now().toISOString(),
        lastError: null });
      for (const change of outcome.changes) {
        this.#context.changed(change);
      }
      for (const questionId of outcome.groupQuestions) {
        this.#answer(questionId, () => this.#responder.askedInGroup(questionId));
      }
      for (const questionId of outcome.questions) {
        this.#answer(questionId, () => this.#responder.askedInChat(questionId));
      }
      this.#options.afterSync?.();
      return reply.envelopes.length;
    } catch (error) {
      if (!this.#controller.signal.aborted) {
        this.#recordError(error);
      }
      throw error;
    }
  }

  /** 开线去答出错不挡收信：问题留在聊天里，记一条。 */
  #answer(questionId: string, open: () => void): void {
    try {
      open();
    } catch (error) {
      safeLog('error', 'network_responder_failed', { objectId: questionId, category: errorCategory(error) });
    }
  }

  #recordError(error: unknown): void {
    const identity = this.#context.state.networkIdentity.get();
    if (identity !== undefined) {
      this.#updateError(identity, humanError(error));
    }
    if (!(error instanceof RelayCallError)) {
      safeLog('error', 'network_sync_failed', { category: errorCategory(error) });
    }
  }

  #updateError(identity: NetworkIdentity, text: string): void {
    if (identity.lastError !== text) {
      this.#context.state.networkIdentity.update(identity.version, { lastError: text });
    }
  }

  async #pollLoop(): Promise<void> {
    const { signal } = this.#controller;
    let failures = 0;
    while (!signal.aborted) {
      if (this.#context.state.networkIdentity.get() === undefined) {
        await sleep(IDLE_MS, signal, (wake) => { this.#wakePoll = wake; });
        continue;
      }
      try {
        await this.syncOnce(this.#options.pollWaitSeconds);
        failures = 0;
      } catch {
        // 原因已经记在 last_error（#recordError），这里只退避。
        failures += 1;
        await sleep(Math.min(SYNC_RETRY_BASE_MS * 2 ** (failures - 1), SYNC_RETRY_MAX_MS), signal);
      }
    }
  }

  async #outboxLoop(): Promise<void> {
    const { signal } = this.#controller;
    while (!signal.aborted) {
      try {
        await this.flush();
      } catch (error) {
        safeLog('error', 'network_send_failed', { category: errorCategory(error) });
      }
      const next = this.#outbox.nextAttemptAt();
      const due = next === undefined ? IDLE_MS : Date.parse(next) - this.#context.now().getTime();
      const wait = Math.max(Math.min(due, IDLE_MS), OUTBOX_MIN_GAP_MS);
      await sleep(wait, signal, (wake) => { this.#wakeOutbox = wake; });
    }
  }
}
