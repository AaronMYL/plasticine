import type { LoadStatus } from '../../state/load.ts';

export interface Loaded<T> {
  status: LoadStatus;
  error: string | null;
  value: T | null;
}

export function idle<T>(): Loaded<T> {
  return { status: 'idle', error: null, value: null };
}

/** Opening a tab reads what it has never read, and what failed last time. */
export function needsRead(data: Loaded<unknown>): boolean {
  return data.status === 'idle' || data.status === 'failed';
}
