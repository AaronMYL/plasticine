import type { BrowserProcess } from './transports.ts';

export const WATCH_EVERY_MS = 5 * 60_000;
export const SPIN_WINDOW_MS = 30 * 60_000;
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
