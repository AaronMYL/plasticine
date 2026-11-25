export class AnswerWaits {
  readonly #waiters = new Map<string, Set<() => void>>();

  wait(askId: string, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new Error('这一轮被叫停了，没有等到他的回答。'));
        return;
      }
      const set = this.#waiters.get(askId) ?? new Set<() => void>();
      const done = (): void => {
        signal?.removeEventListener('abort', aborted);
        resolve();
      };
      const aborted = (): void => {
        set.delete(done);
        if (set.size === 0) {
          this.#waiters.delete(askId);
        }
        reject(new Error('这一轮被叫停了，没有等到他的回答。'));
      };
      set.add(done);
      this.#waiters.set(askId, set);
      signal?.addEventListener('abort', aborted, { once: true });
    });
  }

  notify(askId: string): boolean {
    const set = this.#waiters.get(askId);
    if (set === undefined) {
      return false;
    }
    this.#waiters.delete(askId);
    for (const done of set) {
      done();
    }
    return true;
  }

  get size(): number {
    return this.#waiters.size;
  }
}
