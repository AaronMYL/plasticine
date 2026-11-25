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

  watched(): boolean {
    return this.listeners.size > 0;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
