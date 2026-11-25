import { NODE_HELLO_EVERY_MS, type NodeActionResultRequest, type NodeBusy, type NodeHelloResponse, type NodeLogUpload,
  type NodeWireAction } from '../../../agent/shared/api/index.ts';
import type { DeviceServiceStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import { DEVICE_ACTION_KINDS, type DeviceActionKind, type DeviceLimits } from '../../../agent/shared/state.ts';
import { InvalidActionId, type ActionJournal } from './action-journal.ts';
import type { CredentialStore } from './credential-store.ts';
import { NodeUnauthorized, type NodeApi, type NodeIdentity } from './node-api.ts';

export const HELLO_EVERY_MS = NODE_HELLO_EVERY_MS;
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

export interface ActionRunner {
  capabilities(): Promise<DeviceActionKind[]>;
  execute(action: NodeWireAction, limits: DeviceLimits, progress?: (step: string) => void, cancel?: AbortSignal)
    : Promise<NodeActionResultRequest>;
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
  logsSince(since: string): Omit<NodeLogUpload, 'requestId'>;
}

interface Busy extends NodeBusy {
  cancel: AbortController;
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
  private busy: Busy | null = null;
  private lastLogRequest: string | null = null;

  constructor(deps: NodeServiceDeps, paused: boolean) {
    this.deps = deps;
    this.paused = paused;
  }

  status(): DeviceServiceStatus {
    return structuredClone(this.statusValue);
  }

  get limits(): DeviceLimits | null {
    return this.limitsValue;
  }

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

  private async serve(session: Session, api: NodeApi, credential: string): Promise<void> {
    const hello = await this.hello(api, credential);
    const journal = this.deps.journal(session.server, hello.nodeId);
    const beat = new AbortController();
    const stop = (): void => beat.abort();
    session.abort.signal.addEventListener('abort', stop, { once: true });
    void this.heartbeat(api, credential, beat.signal);
    try {
      await this.work(session, api, credential, journal);
    } finally {
      beat.abort();
      session.abort.signal.removeEventListener('abort', stop);
    }
  }

  private async work(session: Session, api: NodeApi, credential: string, journal: ActionJournal): Promise<void> {
    const signal = session.abort.signal;
    while (!signal.aborted && !this.paused) {
      for (const unsent of journal.unsent()) {
        await api.result(credential, unsent.id, unsent.result);
        journal.uploaded(unsent.id);
      }
      const action = await api.next(credential, signal);
      if (action !== null) {
        try {
          if (journal.seen(action.id)) { continue; }
          journal.begin(action.id, action.kind);
        } catch (error) {
          this.deps.log(`设备动作回执记录失败：${error instanceof Error ? error.message : String(error)}`);
          await api.result(credential, action.id, { status: 'refused', refusalLayer: 'device',
            error: error instanceof InvalidActionId ? '动作编号不合规，这一步没有执行。'
              : '这台电脑无法保存动作回执，这一步没有执行。请检查存储空间或回执记录。' });
          continue;
        }
        const result = await this.perform(action);
        journal.finish(action.id, result);
        this.deps.log(`交结果：${action.kind} ${action.id}`);
        await api.result(credential, action.id, result);
        journal.uploaded(action.id);
      }
    }
  }

  private async perform(action: NodeWireAction): Promise<NodeActionResultRequest> {
    const limits = this.limitsValue;
    if (limits === null) {
      return { status: 'refused', refusalLayer: 'device', error: '还没拿到设备上限，这一步没做。' };
    }
    const started = this.deps.now();
    const busy: Busy = { actionId: action.id, kind: action.kind, step: '领到了',
      since: new Date(started).toISOString(), cancel: new AbortController() };
    this.busy = busy;
    this.deps.log(`开始做：${action.kind} ${action.id}`);
    try {
      const result = await this.deps.runner.execute(action, limits, (step) => {
        busy.step = step.slice(0, 200);
      }, busy.cancel.signal);
      this.deps.log(`做完：${action.kind} ${action.id} ${result.status}${result.errorCode === undefined ? ''
        : ` ${result.errorCode}`} ${this.deps.now() - started}ms`);
      return result;
    } finally {
      if (this.busy === busy) {
        this.busy = null;
      }
    }
  }

  private async hello(api: NodeApi, credential: string): Promise<NodeHelloResponse> {
    const capabilities = await this.deps.runner.capabilities();
    const busy = this.busy === null ? null : { actionId: this.busy.actionId, kind: this.busy.kind,
      step: this.busy.step, since: this.busy.since };
    const hello = await api.hello(credential, { appVersion: this.deps.identity.appVersion, capabilities,
      idleSeconds: await this.deps.idleSeconds(), busy });
    this.limitsValue = hello.limits;
    this.set({ state: 'online', problem: null, capabilities, missing: await this.deps.runner.missing() });
    this.answer(api, credential, hello);
    return hello;
  }

  private async heartbeat(api: NodeApi, credential: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.deps.sleep(HELLO_EVERY_MS, signal);
      if (signal.aborted || this.paused) { return; }
      try {
        await this.hello(api, credential);
      } catch (error) {
        this.deps.log(`报到失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private answer(api: NodeApi, credential: string, hello: NodeHelloResponse): void {
    const busy = this.busy;
    if (busy !== null && (hello.cancel ?? []).includes(busy.actionId)) {
      this.deps.log(`服务器取消了：${busy.kind} ${busy.actionId}`);
      busy.cancel.abort();
    }
    const wanted = hello.logsWanted;
    if (wanted !== undefined && wanted.requestId !== this.lastLogRequest) {
      this.lastLogRequest = wanted.requestId;
      const upload = { requestId: wanted.requestId, ...this.deps.logsSince(wanted.since) };
      void api.uploadLogs(credential, upload).then(() => {
        this.deps.log(`日志已上传：${upload.lines.length} 行`);
      }, (error: unknown) => {
        this.lastLogRequest = null;
        this.deps.log(`日志上传失败：${error instanceof Error ? error.message : String(error)}`);
      });
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

export const ALL_KINDS: readonly DeviceActionKind[] = DEVICE_ACTION_KINDS;
