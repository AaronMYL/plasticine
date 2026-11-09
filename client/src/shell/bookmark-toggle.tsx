// 地址框里右端的书签按钮（第 8 批第 1 条，11-09 设计稿 Bookmarks）：缎带图标，空心 = 当前网址没收藏，实心 = 收藏了；
// 点了收藏或取消收藏当前网址（存进书签，网页栏「书签」一节跟着变）。置顶、放进分组照旧在标签的右键菜单里。
// 没成的交给工具条下面那一句（onError）。

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
      <Icon name={on ? 'bookmark-filled' : 'bookmark'} size={15} />
    </button>
  );
}
