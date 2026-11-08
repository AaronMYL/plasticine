// 最小的可订阅状态：组件用 useStore() 读，切视图、换容器时状态留在这里，不随组件卸载丢掉。

export type Updater<T> = T | ((previous: T) => T);

export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  set(next: Updater<T>): void {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(this.value) : next;
    if (Object.is(value, this.value)) {
      return;
    }
    this.value = value;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
