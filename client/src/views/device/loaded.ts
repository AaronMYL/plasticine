// 设备与度量页每一块数据的样子：没读过 · 在读 · 读到了 · 没读到（原因那一句留着，手里有一份就照常显示那一份）。
// 「没读到」不能画成「没有」：界面按 status 分开写加载中、原因 + 重新读取、确实为空（审查 cb3a98d、3fe8226 P1）。

import { errorText } from '../../api/errors.ts';
import type { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';

export interface Loaded<T> {
  status: LoadStatus;
  error: string | null;
  value: T | null;
}

export function idle<T>(): Loaded<T> {
  return { status: 'idle', error: null, value: null };
}

const generations = new WeakMap<object, number>();

export function invalidateRead(store: object): number {
  const generation = (generations.get(store) ?? 0) + 1;
  generations.set(store, generation);
  return generation;
}

/** Reads into `store`: loading while there is nothing yet, the old value kept on a failure. */
export async function readInto<T>(store: Store<Loaded<T>>, read: () => Promise<T>): Promise<void> {
  const generation = invalidateRead(store);
  store.set((data) => ({ ...data, status: data.value === null ? 'loading' : data.status, error: null }));
  try {
    const value = await read();
    if (generations.get(store) === generation) {
      store.set({ status: 'ready', error: null, value });
    }
  } catch (cause) {
    if (generations.get(store) === generation) {
      store.set((data) => ({ ...data, status: 'failed', error: errorText(cause) }));
    }
  }
}

/** Opening a tab reads what it has never read, and what failed last time. */
export function needsRead(data: Loaded<unknown>): boolean {
  return data.status === 'idle' || data.status === 'failed';
}
