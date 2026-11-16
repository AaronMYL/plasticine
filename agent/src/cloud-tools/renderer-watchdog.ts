// 云端浏览器里空转的网页（11-16 Aaron 定：空转超过 30 分钟自动关）：那天服务器上一个标签的渲染进程占了一核两天，
// 服务卡住时只剩一核。每 5 分钟看一次浏览器各个网页进程用了多少 CPU，一个进程最近 30 分钟里平均占到八成以上，
// 就结束这个进程（那个标签变成「崩溃了」，别的标签不受影响），写一行日志。只看已经连着的浏览器，不为此去连。

import type { BrowserProcess } from './transports.ts';

export const WATCH_EVERY_MS = 5 * 60_000;
export const SPIN_WINDOW_MS = 30 * 60_000;
/** 平均占一核的这么多算空转。 */
export const SPIN_SHARE = 0.8;

interface Sample {
  at: number;
  cpuSeconds: number;
}

export interface WatchdogPorts {
  processes(signal: AbortSignal): Promise<BrowserProcess[] | null>;
  kill(pid: number): void;
  now(): number;
  stopped(pid: number, share: number): void;
  /** 这一次没看成（浏览器正在重启之类），下一次再看。 */
  failed(error: unknown): void;
}

export class RendererWatchdog {
  readonly #ports: WatchdogPorts;
  readonly #samples = new Map<number, Sample[]>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(ports: WatchdogPorts) {
    this.#ports = ports;
  }

  start(): void {
    if (this.#timer !== null) {
      return;
    }
    this.#timer = setInterval(() => {
      this.check(AbortSignal.timeout(10_000)).catch((error: unknown) => this.#ports.failed(error));
    }, WATCH_EVERY_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
    }
    this.#timer = null;
  }

  /** 看一次；回这次结束的进程号。 */
  async check(signal: AbortSignal): Promise<number[]> {
    const list = await this.#ports.processes(signal);
    if (list === null) {
      this.#samples.clear();
      return [];
    }
    const now = this.#ports.now();
    const alive = new Set<number>();
    const stopped: number[] = [];
    for (const process of list.filter((item) => item.type === 'renderer')) {
      alive.add(process.pid);
      const samples = [...(this.#samples.get(process.pid) ?? []), { at: now, cpuSeconds: process.cpuSeconds }]
        .filter((sample) => now - sample.at <= SPIN_WINDOW_MS + WATCH_EVERY_MS);
      this.#samples.set(process.pid, samples);
      const first = samples[0]!;
      const span = now - first.at;
      if (span < SPIN_WINDOW_MS) {
        continue;
      }
      const share = (process.cpuSeconds - first.cpuSeconds) * 1000 / span;
      if (share >= SPIN_SHARE) {
        this.#ports.kill(process.pid);
        this.#ports.stopped(process.pid, share);
        this.#samples.delete(process.pid);
        stopped.push(process.pid);
      }
    }
    for (const pid of [...this.#samples.keys()]) {
      if (!alive.has(pid)) {
        this.#samples.delete(pid);
      }
    }
    return stopped;
  }
}
