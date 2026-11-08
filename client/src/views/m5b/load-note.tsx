// 工具组几页共用的「读的状态」那一句：正在读；读失败说原因并给「重新读取」（手里有一份就照常显示那一份，这句在上面）。
// 读失败从不显示成空（审查要求：读取失败显示成空是 P1）。

import type { ReactNode } from 'react';
import type { Resource } from './resource-store.ts';

export interface LoadNoteProps<T> {
  resource: Resource<T>;
  /** 「正在读账本…」里的「账本」。 */
  what: string;
  onRetry: () => void;
}

export function LoadNote<T>({ resource, what, onRetry }: LoadNoteProps<T>): ReactNode {
  if (resource.error !== null) {
    return (
      <p className="block-empty is-error" role="alert">
        {resource.error}{' '}
        <button type="button" className="text-button" onClick={onRetry}>
          重新读取
        </button>
      </p>
    );
  }
  if (resource.value === null && (resource.status === 'loading' || resource.status === 'idle')) {
    return <p className="block-empty">正在读{what}…</p>;
  }
  return null;
}

/** 金额（整数分）按人民币写：¥1,234.50；负的带减号。 */
export function yuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const text = (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}¥${text}`;
}

/** 一个时刻按本机时区写成「10-27 14:05」（等宽字体那一处用）。 */
export function shortTime(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}
