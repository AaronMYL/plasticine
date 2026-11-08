// Counts failed attempts in a sliding window. Behind Caddy every request comes from 127.0.0.1, so the count is
// global: too many wrong pairing codes pause pairing for everyone until the window moves on.

export class AttemptLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #failures: number[] = [];

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  blocked(): boolean {
    this.#prune();
    return this.#failures.length >= this.#limit;
  }

  recordFailure(): void {
    this.#prune();
    this.#failures.push(this.#now());
  }

  /** How long until the oldest failure in the window expires; 0 when not blocked. */
  retryAfterMs(): number {
    this.#prune();
    const oldest = this.#failures[0];
    if (oldest === undefined || this.#failures.length < this.#limit) {
      return 0;
    }
    return Math.max(0, oldest + this.#windowMs - this.#now());
  }

  #prune(): void {
    const cutoff = this.#now() - this.#windowMs;
    this.#failures = this.#failures.filter((at) => at > cutoff);
  }
}
