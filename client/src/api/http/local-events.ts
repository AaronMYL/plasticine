import type { LiveEvent } from '../types.ts';

export type LiveListener = (event: LiveEvent) => void;

export class LocalEvents {
  private readonly listeners = new Set<LiveListener>();

  on(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: LiveEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
