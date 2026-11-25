type Listener = (files: File[]) => void;

let waiting: File[] = [];
const listeners = new Set<Listener>();

export function queueBookImport(files: readonly File[]): void {
  if (files.length === 0) return;
  if (listeners.size === 0) {
    waiting = [...waiting, ...files];
    return;
  }
  for (const listener of listeners) listener([...files]);
}

export function onQueuedBookImport(listener: Listener): () => void {
  listeners.add(listener);
  if (waiting.length > 0) {
    const files = waiting;
    waiting = [];
    listener(files);
  }
  return () => {
    listeners.delete(listener);
  };
}
