// 书的列表：图书馆、第二栏「在读」共用一份（state/live-query.ts），回来直接画；书变了（不算 AI 侧栏的变化）重读。

import { useApi } from '../../api/context.tsx';
import type { BookView } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { useQuery } from '../../state/use-query.ts';

const BOOK_EVENTS = (event: LiveEvent): boolean => event.type === 'book.changed' && event.part !== 'insights';

export function useBooksList(): { books: BookView[] | null; error: string | null; reload: () => void } {
  const api = useApi();
  const query = useQuery('books.list', (signal) => api.books.list(signal).then((result) => result.books), BOOK_EVENTS);
  return { books: query.data, error: query.error, reload: query.reload };
}
