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
