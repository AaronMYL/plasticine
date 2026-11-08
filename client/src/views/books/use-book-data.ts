// 阅读页和浮层要的几样数据：书、标注、大纲 / 重点、讨论。各自一个 hook，打开时读一次；事件流里来了这本书的
// book.changed 就只重拉对应那一块（part），断线补不上（resync）时全部重拉。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { BookAnnotationView, BookDiscussion, BookInsightKind, BookInsightView,
  BookView } from '../../api/shared.ts';
import type { BookChangedPart } from '../../api/types.ts';
import { useLive } from '../../live.tsx';

export interface Loaded<T> {
  value: T | null;
  error: string | null;
  reload: () => void;
}

/** 读一样东西，并在这本书的某几种 book.changed 来时重读。读的时候不清空旧值，避免闪一下空白。 */
function useBookResource<T>(bookId: string | null, parts: readonly BookChangedPart[],
  load: (id: string, signal: AbortSignal) => Promise<T>, enabled = true): Loaded<T> {
  const live = useLive();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const partsKey = parts.join(',');
  const reload = useCallback(() => setGeneration((count) => count + 1), []);
  useEffect(() => {
    if (bookId === null || !enabled) {
      return undefined;
    }
    const controller = new AbortController();
    loadRef.current(bookId, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setValue(next);
        setError(null);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorText(cause));
      }
    });
    return () => controller.abort();
  }, [bookId, enabled, generation]);
  useEffect(() => {
    if (bookId === null || !enabled) {
      return undefined;
    }
    const wanted = partsKey.split(',');
    return live.hub.on((event) => {
      if (event.type === 'resync' || event.type === 'book.changed' && event.bookId === bookId
        && wanted.includes(event.part)) {
        reload();
      }
    });
  }, [live.hub, bookId, enabled, partsKey, reload]);
  return { value, error, reload };
}

export function useBook(bookId: string): Loaded<BookView> {
  const api = useApi();
  return useBookResource(bookId, ['book', 'annotations'], (id, signal) => api.books.get(id, signal));
}

export function useAnnotations(bookId: string): Loaded<BookAnnotationView[]> {
  const api = useApi();
  return useBookResource(bookId, ['annotations'],
    async (id, signal) => (await api.books.annotations(id, signal)).annotations);
}

export function useInsight(bookId: string, kind: BookInsightKind, enabled = true): Loaded<BookInsightView> {
  const api = useApi();
  return useBookResource(bookId, ['insights'], (id, signal) => api.books.insight(id, kind, signal), enabled);
}

/** 讨论来自主对话，书本身的事件不管它；浮层打开时读一次，点「讨论」tab 不再等。 */
export function useDiscussions(bookId: string, enabled: boolean): Loaded<BookDiscussion[]> {
  const api = useApi();
  return useBookResource(bookId, [], async (id, signal) => (await api.books.discussions(id, signal)).discussions,
    enabled);
}
