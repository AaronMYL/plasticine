// 删书签不弹确认（第 8 批第 1 条，设计稿 Bookmark-Undo）：那一行原处换成「已删除「…」 撤销」，过几秒或点到别处就收走；
// 撤销放回原处（服务端撤销移除，位置没变）。删除先发出去，撤销等删除回来再撤（要带移除之后的版本）。没成的写一句原因，
// 同样过几秒收走（没删掉的那一行随之回来）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../api/errors.ts';
import type { BookmarkView } from '../../api/shared.ts';
import type { BookmarkStore } from '../../views/bookmarks/bookmark-store.ts';

/** 「撤销」那一行留多久（毫秒）：够看一眼、点一下。 */
export const BOOKMARK_UNDO_MS = 5_000;
/** 撤销那一行带这个属性：在它里面按下不算「点别处」。 */
export const GONE_ATTRIBUTE = 'data-bookmark-gone';

export interface GoneBookmark {
  view: BookmarkView;
  /** 删之前在第几个（撤销那一行画在这里）。 */
  index: number;
  /** 没删掉 / 没撤销成的原因；有它就不再有「撤销」。 */
  error: string | null;
}

export interface BookmarkUndo {
  gone: GoneBookmark | null;
  remove: (view: BookmarkView, index: number) => void;
  undo: () => void;
}

export function useBookmarkUndo(store: BookmarkStore): BookmarkUndo {
  const [gone, setGone] = useState<GoneBookmark | null>(null);
  const removing = useRef<Promise<BookmarkView> | null>(null);
  const dismiss = useCallback((): void => {
    removing.current = null;
    setGone(null);
  }, []);

  useEffect(() => {
    if (gone === null) {
      return undefined;
    }
    const timer = window.setTimeout(dismiss, BOOKMARK_UNDO_MS);
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest(`[${GONE_ATTRIBUTE}]`) === null) {
        dismiss();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [gone, dismiss]);

  const remove = (view: BookmarkView, index: number): void => {
    const pending = store.remove(view);
    removing.current = pending;
    setGone({ view, index, error: null });
    pending.catch((cause: unknown) => {
      console.warn('书签没删掉', cause);
      if (removing.current === pending) {
        setGone({ view, index, error: `没删掉：${errorText(cause)}` });
      }
    });
  };

  const undo = (): void => {
    const pending = removing.current;
    if (pending === null || gone === null) {
      return;
    }
    const { view, index } = gone;
    removing.current = null;
    pending.then((removed) => store.restore(removed)).then(() => {
      setGone((current) => (current?.view.id === view.id ? null : current));
    }, (cause: unknown) => {
      console.warn('书签没撤销成', cause);
      setGone({ view, index, error: `没撤销成：${errorText(cause)}` });
    });
  };

  return { gone, remove, undo };
}
