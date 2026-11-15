// 设备与度量页每一块数据的样子：没读过 · 在读 · 读到了 · 没读到（原因那一句留着，手里有一份就照常显示那一份）。
// 「没读到」不能画成「没有」：界面按 status 分开写加载中、原因 + 再读一次、确实为空（审查 cb3a98d、3fe8226 P1）。

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
