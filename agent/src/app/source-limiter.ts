// 按来源加全局的失败计数（2026-11-08 密码登录）：每个来源一个 AttemptLimiter（沿用配对码的滑动窗口），再加一个
// 所有来源一起数的。来源的那份窗口过了、清空了就扔掉，表不会一直长。

import { AttemptLimiter } from './attempt-limiter.ts';

export interface SourceLimits {
  perSource: number;
  global: number;
  windowMs: number;
}

export class SourceLimiter {
  readonly #limits: SourceLimits;
  readonly #now: () => number;
  readonly #global: AttemptLimiter;
  readonly #bySource = new Map<string, AttemptLimiter>();

  constructor(limits: SourceLimits, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
    this.#global = new AttemptLimiter(limits.global, limits.windowMs, now);
  }

  blocked(source: string): boolean {
    return this.#global.blocked() || (this.#bySource.get(source)?.blocked() ?? false);
  }

  recordFailure(source: string): void {
    this.#global.recordFailure();
    let limiter = this.#bySource.get(source);
    if (limiter === undefined) {
      limiter = new AttemptLimiter(this.#limits.perSource, this.#limits.windowMs, this.#now);
      this.#bySource.set(source, limiter);
    }
    limiter.recordFailure();
    this.#forgetQuiet();
  }

  /** 要等多久才放开（两份里更久的那份）；没挡着是 0。 */
  retryAfterMs(source: string): number {
    return Math.max(this.#global.retryAfterMs(), this.#bySource.get(source)?.retryAfterMs() ?? 0);
  }

  #forgetQuiet(): void {
    for (const [source, limiter] of this.#bySource) {
      if (limiter.empty()) {
        this.#bySource.delete(source);
      }
    }
  }
}
