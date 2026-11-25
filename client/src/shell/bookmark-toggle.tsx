import { useState, type ReactNode } from 'react';
import { errorText } from '../api/errors.ts';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';
import { Icon } from './icons.tsx';
import './bookmark-toggle.css';

export interface BookmarkToggleProps {
  url: string;
  title: string;
  onError: (text: string) => void;
}

export function BookmarkToggle({ url, title, onError }: BookmarkToggleProps): ReactNode {
  const store = useLive().bookmarks;
  useStore(store.data);
  const [busy, setBusy] = useState(false);
  const saved = store.findWeb(url);
  const on = saved !== null;
  const label = on ? '取消书签' : '加书签';
  const toggle = (): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    const job = saved === null ? store.addWeb(url, title) : store.remove(saved);
    job.catch((cause: unknown) => {
      console.warn(`${label}没成`, cause);
      onError(`${on ? '没取消书签' : '没加上书签'}：${errorText(cause)}。`);
    }).finally(() => setBusy(false));
  };
  return (
    <button type="button" className="web-address-bookmark" aria-label={label} aria-pressed={on} data-tip={label}
      data-tip-side="bottom" onClick={toggle}>
      <Icon name={on ? 'bookmark-filled' : 'bookmark'} size={16} />
    </button>
  );
}
