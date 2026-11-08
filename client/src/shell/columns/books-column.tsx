// 图书栏目的第二栏（第 7 批设计稿 Books）：第一行「图书馆」（全部几本），下面「在读」（最近读的在前，行尾进度）。
// 栏头「导入书」：在这里选文件，交给图书馆页导入并显示进度（import-queue.ts）。数据：GET /v2/books，书有变化时重读。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { BOOK_FILE_EXTENSIONS, type BookView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { percentText } from '../../views/books/book-format.ts';
import { queueBookImport } from '../../views/books/import-queue.ts';
import { IconButton } from '../icon-button.tsx';
import { Icon } from '../icons.tsx';
import type { Route } from '../routes.ts';
import { ColumnCount, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

/** 「在读」最多列几本；全部在图书馆里。 */
const READING_SHOWN = 6;
const LIBRARY_ROUTE: Route = { view: 'books', noteId: null, bookId: null };

function useBooks(): { books: BookView[] | null; error: string | null } {
  const api = useApi();
  const live = useLive();
  const [state, setState] = useState<{ books: BookView[] | null; error: string | null }>({ books: null, error: null });
  const [round, setRound] = useState(0);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'book.changed' && event.part !== 'insights') {
      setRound((value) => value + 1);
    }
  }), [live.hub]);
  useEffect(() => {
    const controller = new AbortController();
    api.books.list(controller.signal).then((result) => {
      if (!controller.signal.aborted) setState({ books: result.books, error: null });
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, error: errorText(cause) }));
    });
    return () => controller.abort();
  }, [api, round]);
  return state;
}

/** 打开过的书，最近读的在前。 */
export function readingBooks(books: readonly BookView[]): BookView[] {
  return books.filter((book) => book.progress !== null)
    .sort((a, b) => (b.progress?.updatedAt ?? '').localeCompare(a.progress?.updatedAt ?? ''))
    .slice(0, READING_SHOWN);
}

export function BooksColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { books, error } = useBooks();
  const picker = useRef<HTMLInputElement>(null);
  const bookId = route.view === 'books' ? route.bookId ?? null : null;
  const reading = books === null ? [] : readingBooks(books);
  return (
    <>
      <ColumnHead title="图书">
        <IconButton icon="upload" label="导入书" onClick={() => picker.current?.click()} />
      </ColumnHead>
      <input ref={picker} type="file" accept={BOOK_FILE_EXTENSIONS.join(',')} multiple hidden
        aria-label="从图书栏选择要导入的书" onChange={(event) => {
          const files = [...event.target.files ?? []];
          event.target.value = '';
          if (files.length === 0) return;
          queueBookImport(files);
          if (route.view !== 'books' || bookId !== null) navigate(LIBRARY_ROUTE);
        }} />
      <div className="column-scroll">
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        <ColumnLink route={LIBRARY_ROUTE} current={route.view === 'books' && bookId === null} navigate={navigate}
          lead={<Icon name="library" size={16} />} trail={<ColumnCount value={books?.length ?? null} label="本" />}>
          图书馆
        </ColumnLink>
        {reading.length === 0 ? null : <>
          <ColumnLabel>在读</ColumnLabel>
          {reading.map((book) => (
            <ColumnLink key={book.id} route={{ view: 'books', noteId: null, bookId: book.id }}
              current={bookId === book.id} navigate={navigate} lead={<Icon name="books" size={16} />}
              trail={<span className="column-count">{percentText(book.progress?.percent ?? 0)}</span>}>
              {book.title}
            </ColumnLink>
          ))}
        </>}
      </div>
    </>
  );
}
