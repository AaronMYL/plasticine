import type { ReactNode } from 'react';
import type { Resource } from '../state/resource-store.ts';

export interface LoadNoteProps<T> {
  resource: Resource<T>;
  what: string;
  onRetry: () => void;
}

export function LoadNote<T>({ resource, what, onRetry }: LoadNoteProps<T>): ReactNode {
  if (resource.error !== null) {
    return (
      <p className="block-empty is-error" role="alert">
        {resource.error}{' '}
        <button type="button" className="text-button" onClick={onRetry}>
          再读一次
        </button>
      </p>
    );
  }
  if (resource.value === null && (resource.status === 'loading' || resource.status === 'idle')) {
    return <p className="block-empty">正在读{what}…</p>;
  }
  return null;
}

export function yuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const text = (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}¥${text}`;
}

export function shortTime(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}
