// 等他在卡上定：出卡的工具（硬线、问他）在这里挂着，卡一答（要你定卡的 resolver 提交之后）就放开。
// 只在内存里：服务重启后没人等了，答案到时 kernel 从库里接着跑（重跑那次工具调用，卡按动作标识认出来、直接拿答案）。

export class AnswerWaits {
  readonly #waiters = new Map<string, Set<() => void>>();

  /** 等这张卡答（或撤回）；叫停时带着原因拒绝。 */
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

  /** 卡答了：放开等它的；返回有没有人在等（没人等说明是重启前出的卡）。 */
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
