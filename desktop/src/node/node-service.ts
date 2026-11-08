// 让 Plasticine 用这台电脑（设计稿 Settings-System 最后一行）：设备服务。照 Mac 壳 node-service.swift 的走法：
// 有凭证就 hello（启动时、每 60 秒，带会做的事和他多久没动键鼠）、先交没交上的回执、再长轮询领动作；同一个动作 id
// 只做一次。401 停下来显示「需要重新配对」；网络错按 1、2、4…32 秒退避。本体换了（设置 · 系统里切换）就整个换过去。

import type { NodeActionResultRequest, NodeWireAction } from '../../../agent/shared/api/index.ts';
import type { DeviceServiceStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import { DEVICE_ACTION_KINDS, type DeviceActionKind, type DeviceLimits } from '../../../agent/shared/state.ts';
import type { ActionJournal } from './action-journal.ts';
import type { CredentialStore } from './credential-store.ts';
import { NodeUnauthorized, type NodeApi, type NodeIdentity } from './node-api.ts';

export const HELLO_EVERY_MS = 60_000;
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

export interface ActionRunner {
  /** 这台电脑现在会做的事（助手报的方法、网页标签在不在）。 */
  capabilities(): Promise<DeviceActionKind[]>;
  /** 照上限判、该问就问、做、回执；不抛错（出错写进回执）。 */
  execute(action: NodeWireAction, limits: DeviceLimits): Promise<NodeActionResultRequest>;
  /** 系统权限没给的几样，给设置页列出来。 */
  missing(): Promise<DeviceServiceStatus['missing']>;
}

export interface NodeServiceDeps {
  api(server: string): NodeApi;
  credentials: CredentialStore;
  journal(server: string, nodeId: string): ActionJournal;
  runner: ActionRunner;
  identity: NodeIdentity;
  idleSeconds(): Promise<number | null>;
  requestId(): string;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  log(line: string): void;
}

interface Session {
  server: string;
  abort: AbortController;
}

export class NodeService {
  private readonly deps: NodeServiceDeps;
  private session: Session | null = null;
  private paused: boolean;
  private statusValue: DeviceServiceStatus = { state: 'unpaired', server: null, capabilities: [], missing: [],
    problem: null };
  private limitsValue: DeviceLimits | null = null;
  private readonly listeners = new Set<(status: DeviceServiceStatus) => void>();
  private wake: (() => void) | null = null;

  constructor(deps: NodeServiceDeps, paused: boolean) {
    this.deps = deps;
    this.paused = paused;
  }

  status(): DeviceServiceStatus {
    return structuredClone(this.statusValue);
  }

  /** 最近一次 hello 拿到的设备上限；还没连上是 null。 */
  get limits(): DeviceLimits | null {
    return this.limitsValue;
  }

  /** 现在这个本体上的节点凭证（信息流的取数也用它）；没配对是 null。 */
  credential(): { server: string; credential: string } | null {
    const server = this.session?.server;
    if (server === undefined) {
      return null;
    }
    const credential = this.deps.credentials.read(server);
    return credential === null ? null : { server, credential };
  }

  onChange(listener: (status: DeviceServiceStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 换到另一个本体（或 null：不连）。 */
  useServer(server: string | null): void {
    if (this.session?.server === server) {
      return;
    }
    this.session?.abort.abort();
    this.session = null;
    this.limitsValue = null;
    if (server === null) {
      this.set({ state: 'unpaired', server: null, problem: null });
      return;
    }
    const session: Session = { server, abort: new AbortController() };
    this.session = session;
    void this.run(session).catch((error: unknown) => {
      this.deps.log(`设备服务停了：${error instanceof Error ? error.message : String(error)}`);
      if (this.session === session) {
        this.set({ state: 'offline', problem: '设备服务出错停了，重新打开 Plasticine 再试。' });
      }
    });
  }

  async pair(code: string): Promise<DeviceServiceStatus> {
    const session = this.session;
    if (session === null) {
      throw new Error('还没连上本体，先在设置 · 系统里选好 Plasticine 跑在哪。');
    }
    const capabilities = await this.deps.runner.capabilities();
    const paired = await this.deps.api(session.server).pair({ requestId: this.deps.requestId(), code,
      identity: this.deps.identity, capabilities });
    this.deps.credentials.save(session.server, paired.credential);
    this.limitsValue = paired.limits;
    this.set({ state: 'connecting', problem: null });
    this.wake?.();
    return this.status();
  }

  pause(paused: boolean): DeviceServiceStatus {
    this.paused = paused;
    this.set({ state: paused ? 'paused' : 'connecting' });
    this.wake?.();
    return this.status();
  }

  stop(): void {
    this.session?.abort.abort();
    this.session = null;
  }

  private async run(session: Session): Promise<void> {
    const signal = session.abort.signal;
    const api = this.deps.api(session.server);
    this.set({ state: 'connecting', server: session.server, problem: null,
      capabilities: await this.deps.runner.capabilities(), missing: await this.deps.runner.missing() });
    let failures = 0;
    while (!signal.aborted) {
      const credential = this.deps.credentials.read(session.server);
      if (credential === null || this.paused) {
        const unpaired = this.statusValue.state === 'repair' ? 'repair' : 'unpaired';
        this.set({ state: credential === null ? unpaired : 'paused' });
        await this.idle(signal);
        continue;
      }
      try {
        await this.serve(session, api, credential);
        failures = 0;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (error instanceof NodeUnauthorized) {
          this.deps.credentials.forget(session.server);
          this.set({ state: 'repair', problem: error.message });
          continue;
        }
        const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 32_000;
        failures += 1;
        this.set({ state: 'offline', problem: `连不上本体，${Math.round(delay / 1000)} 秒后再试。` });
        this.deps.log(`设备服务：${error instanceof Error ? error.message : String(error)}`);
        await this.deps.sleep(delay, signal);
      }
    }
  }

  /** 连着的时候一直在这里：hello、交回执、领动作、做。暂停或出错时返回 / 抛出。 */
  private async serve(session: Session, api: NodeApi, credential: string): Promise<void> {
    const signal = session.abort.signal;
    let helloAt = Number.NEGATIVE_INFINITY;
    let journal: ActionJournal | null = null;
    while (!signal.aborted && !this.paused) {
      if (this.deps.now() - helloAt >= HELLO_EVERY_MS || journal === null) {
        const capabilities = await this.deps.runner.capabilities();
        const hello = await api.hello(credential, { appVersion: this.deps.identity.appVersion, capabilities,
          idleSeconds: await this.deps.idleSeconds() });
        helloAt = this.deps.now();
        this.limitsValue = hello.limits;
        journal = this.deps.journal(session.server, hello.nodeId);
        this.set({ state: 'online', problem: null, capabilities, missing: await this.deps.runner.missing() });
      }
      for (const unsent of journal.unsent()) {
        await api.result(credential, unsent.id, unsent.result);
        journal.uploaded(unsent.id);
      }
      const action = await api.next(credential, signal);
      if (action !== null && !journal.seen(action.id)) {
        journal.begin(action.id, action.kind);
        const limits = this.limitsValue;
        const result = limits === null ? { status: 'refused' as const, refusalLayer: 'device' as const,
          error: '还没拿到设备上限，这一步没做。' } : await this.deps.runner.execute(action, limits);
        journal.finish(action.id, result);
        await api.result(credential, action.id, result);
        journal.uploaded(action.id);
      }
    }
  }

  private idle(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.wake = null;
        signal.removeEventListener('abort', done);
        resolve();
      };
      this.wake = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }

  private set(change: Partial<DeviceServiceStatus>): void {
    this.statusValue = { ...this.statusValue, ...change };
    const status = this.status();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

/** 共享 schema 里全部的动作名（给能力清单过滤用）。 */
export const ALL_KINDS: readonly DeviceActionKind[] = DEVICE_ACTION_KINDS;
