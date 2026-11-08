// 外环的定时部分（《实施方案》第 6 节：没有新消息时外环照转）：每隔一段时间跑一遍登记过的扫描——触发条件、采访、十件事、
// 站外信息流。每个扫描自己幂等；一个出错只记日志、不拦其他的，下一轮再跑。返回 Promise 的扫描还没跑完时，下一轮跳过它
// （审查 2026-11-01：同一个扫描不并发两份，收信、自迭代接续这类长活不靠自己的锁也不会叠起来）。计时器 unref，停的时候清掉。

import { errorCategory, safeLog } from '../shared-log.ts';

// 5 分钟：触发和采访都以「天」「期限」计，5 分钟的误差看不出；更密只会多写库（方案没定，跑出记录后改）。
export const SCAN_TICK_MS = 5 * 60 * 1000;

export interface Scan {
  name: string;
  run(): unknown;
}

export interface ScanResult {
  name: string;
  ok: boolean;
  result?: unknown;
  /** The previous run of this scan (a Promise) had not finished: nothing was started this round. */
  skipped?: boolean;
}

interface ScanStatus {
  name: string;
  /** When the last run started (ISO). */
  at: string;
  error: string | null;
  running: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ScanScheduler {
  readonly #scans: Scan[] = [];
  readonly #tickMs: number;
  readonly #status = new Map<string, ScanStatus>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: { tickMs?: number } = {}) {
    this.#tickMs = options.tickMs ?? SCAN_TICK_MS;
  }

  add(scan: Scan): void {
    this.#scans.push(scan);
  }

  status(): ScanStatus[] {
    return [...this.#status.values()];
  }

  /** Runs every scan once, in the order they were added; a scan still running from an earlier round is skipped. */
  runOnce(): ScanResult[] {
    return this.#scans.map((scan) => this.#runScan(scan));
  }

  #runScan(scan: Scan): ScanResult {
    if (this.#status.get(scan.name)?.running === true) {
      return { name: scan.name, ok: true, skipped: true };
    }
    const record: ScanStatus = { name: scan.name, at: new Date().toISOString(), error: null, running: true };
    this.#status.set(scan.name, record);
    try {
      const result = scan.run();
      if (result instanceof Promise) {
        this.#watch(scan.name, record, result);
      } else {
        record.running = false;
      }
      return { name: scan.name, ok: true, result };
    } catch (error) {
      record.running = false;
      record.error = messageOf(error);
      safeLog('error', 'scan_failed', { objectId: scan.name, category: errorCategory(error), error });
      return { name: scan.name, ok: false };
    }
  }

  /** An async scan's outcome lands in its status when it settles; the round does not wait for it. */
  #watch(name: string, record: ScanStatus, work: Promise<unknown>): void {
    void work.then(
      () => {
        record.running = false;
      },
      (error: unknown) => {
        record.running = false;
        record.error = messageOf(error);
        safeLog('error', 'scan_failed', { objectId: name, category: errorCategory(error), error });
      },
    );
  }

  start(): void {
    if (this.#timer !== undefined) {
      return;
    }
    this.#timer = setInterval(() => this.runOnce(), this.#tickMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
