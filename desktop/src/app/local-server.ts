// 「这台电脑」模式下壳拉起并守着自带的本体（和 Swift 版 local-server.swift、Windows 托盘 ServerProcess.cs 同一套做法）：
// 用自带的 Node 跑 agent/src/app/main.ts，崩了按 1、2、4…30 秒退避重启，稳定跑满一分钟退避归零。停的时候先关 stdin
// （本体设了 PLASTICINE_STOP_ON_STDIN_EOF=1，读到结尾自己收尾；壳被强制结束、管道一断也一样，不留孤儿进程占端口），
// 再发 SIGTERM，4 秒后还在就强制结束。日志写进 logs/server.log，超过 10 MB 换一份、只留上一份。

import type { ChildProcess } from 'node:child_process';
import type { LocalServerState } from '../../../agent/shared/api/desktop-bridge.ts';
import { LOCAL_SERVER_PORT } from './server-target.ts';

/** 崩溃后隔多久重启。 */
export const RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** 跑满这么久才算稳定，下次崩溃从 1 秒重新数。 */
export const STABLE_MS = 60_000;
/** 第一次开库、补跑任务；Linux 安装包的健康检查也给一分钟。 */
export const HEALTH_TIMEOUT_MS = 60_000;
/** 退出客户端时等本体收尾的上限。 */
export const STOP_GRACE_MS = 4_000;

export class RestartBackoff {
  private failures = 0;

  next(ranForMs: number): number {
    if (ranForMs >= STABLE_MS) {
      this.failures = 0;
    }
    const delay = RESTART_DELAYS_MS[Math.min(this.failures, RESTART_DELAYS_MS.length - 1)] ?? 30_000;
    this.failures += 1;
    return delay;
  }
}

/** 本体进程的环境：只带几样系统变量，其余全是安装包的设置。 */
export function serverEnvironment(input: { platform: NodeJS.Platform; serverDirectory: string; stateDirectory: string;
  base: NodeJS.ProcessEnv; join(...parts: string[]): string }): Record<string, string> {
  const inherited = input.platform === 'win32'
    ? ['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ComSpec',
      'PATHEXT', 'windir', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME']
    : ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL'];
  const environment: Record<string, string> = {};
  for (const key of inherited) {
    const value = input.base[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  if (input.platform !== 'win32') {
    // 服务器命令（cloud-tools/server-shell.ts）跑的是 bash；带上 Homebrew 的路径，常用工具才找得到。
    environment.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  }
  environment.PLASTICINE_STATE = input.stateDirectory;
  environment.PLASTICINE_PORT = String(LOCAL_SERVER_PORT);
  environment.PLASTICINE_CLIENT_DIR = input.join(input.serverDirectory, 'client', 'dist');
  // WebKit / Chromium 都不收明文 http 下带 Secure 的 Cookie。
  environment.PLASTICINE_PLAIN_HTTP = '1';
  // 2026-11-05 他定：装在这台电脑上的实例真跑；对外的动作仍由硬线审批把关。
  environment.PLASTICINE_DRY_RUN = '0';
  environment.PLASTICINE_STOP_ON_STDIN_EOF = '1';
  return environment;
}

export interface LocalServerDeps {
  /** 拉起本体进程；没带本体时不会被调。 */
  launch(): ChildProcess;
  /** 本体在 timeoutMs 内答上 /v2/health 就是 true；signal 取消时尽快回 false。 */
  healthy(timeoutMs: number, signal: AbortSignal): Promise<boolean>;
  now(): number;
  log(line: string): void;
}

export class LocalServer {
  private readonly deps: LocalServerDeps;
  private readonly bundled: boolean;
  private child: ChildProcess | null = null;
  private wanted = false;
  private startedAt = 0;
  private readonly backoff = new RestartBackoff();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private health: AbortController | null = null;
  private stateValue: LocalServerState;
  private problemText: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(deps: LocalServerDeps, bundled: boolean) {
    this.deps = deps;
    this.bundled = bundled;
    this.stateValue = bundled ? 'stopped' : 'absent';
  }

  get state(): LocalServerState {
    return this.stateValue;
  }

  get problem(): string | null {
    return this.problemText;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 起本体并在答上健康检查时回 true；没带本体、一分钟没答上回 false（守护照样继续）。 */
  async start(): Promise<boolean> {
    if (!this.bundled) {
      this.set('absent', '这个安装包没有带本体，请在设置 · 系统里改用远程地址。');
      return false;
    }
    this.wanted = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child === null) {
      this.launch();
    }
    return this.stateValue === 'running' ? true : this.waitRunning();
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.health?.abort();
    const child = this.child;
    if (child === null) {
      this.set(this.bundled ? 'stopped' : 'absent', null);
      return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.stdin?.end();
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      this.deps.log('本体 4 秒没退，强制结束。');
      child.kill('SIGKILL');
    }, STOP_GRACE_MS);
    await exited;
    clearTimeout(timer);
    this.child = null;
    this.set('stopped', null);
  }

  private waitRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.stateValue === 'running') {
          unsubscribe();
          resolve(true);
        } else if (!this.wanted || (this.stateValue === 'failed' && this.child === null)) {
          unsubscribe();
          resolve(false);
        }
      };
      const unsubscribe = this.onChange(check);
      check();
    });
  }

  private launch(): void {
    let child: ChildProcess;
    try {
      child = this.deps.launch();
    } catch (error) {
      this.set('failed', `本机本体没能启动：${error instanceof Error ? error.message : String(error)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.startedAt = this.deps.now();
    this.set('starting', null);
    child.once('error', (error) => this.deps.log(`本体进程出错：${error.message}`));
    child.once('exit', (code, signal) => this.exited(child, code, signal));
    const health = new AbortController();
    this.health = health;
    void this.deps.healthy(HEALTH_TIMEOUT_MS, health.signal).then((ok) => {
      if (this.child !== child || health.signal.aborted) {
        return;
      }
      if (ok) {
        this.set('running', null);
      } else {
        this.set('starting', '本机本体一分钟还没答上，还在等。日志在 logs/server.log。');
      }
    });
  }

  private exited(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) {
      return;
    }
    this.child = null;
    this.health?.abort();
    if (!this.wanted) {
      this.set('stopped', null);
      return;
    }
    this.set('failed', `本机本体退出了（${code ?? signal ?? '未知'}），正在重启。`);
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    const delay = this.backoff.next(this.deps.now() - this.startedAt);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wanted && this.child === null) {
        this.launch();
      }
    }, delay);
  }

  private set(state: LocalServerState, problem: string | null): void {
    this.stateValue = state;
    this.problemText = problem;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
