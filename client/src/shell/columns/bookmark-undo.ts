import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../api/errors.ts';
import type { BookmarkView } from '../../api/shared.ts';
import type { BookmarkStore } from '../../views/bookmarks/bookmark-store.ts';

export const BOOKMARK_UNDO_MS = 5_000;
export const GONE_ATTRIBUTE = 'data-bookmark-gone';

export interface GoneBookmark {
  view: BookmarkView;
  index: number;
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
      console.warn('书签没删除', cause);
      if (removing.current === pending) {
        setGone({ view, index, error: `没删除：${errorText(cause)}` });
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
