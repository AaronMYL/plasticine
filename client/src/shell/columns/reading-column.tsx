// 阅读栏目的第二栏（11-11 第 11 批，信息流和图书并成阅读；设计稿「P2 阅读」）：信息流、收藏，「图书馆」（全部图书和在读的
// 书，行尾进度），「来源」每个来源一行（行尾 ⋯ 管这个来源，列表在 views/feed/feed-source-list.tsx，手机筛选抽屉共用）。
// 栏头两个按钮：加来源、导入书（在这里选文件，交给图书馆页导入并显示进度，import-queue.ts）。

import { useRef, type ReactNode } from 'react';
import { BOOK_FILE_EXTENSIONS, type BookView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { segmentOf, type FeedSegment } from '../../state/feed-ui.ts';
import { useStore } from '../../state/use-store.ts';
import { percentText } from '../../views/books/book-format.ts';
import { queueBookImport } from '../../views/books/import-queue.ts';
import { useBooksList } from '../../views/books/use-books-list.ts';
import { useFeedNav } from '../../views/feed/feed-nav-data.ts';
import { FeedSourceList } from '../../views/feed/feed-source-list.tsx';
import { IconButton } from '../icon-button.tsx';
import { Icon } from '../icons.tsx';
import type { Route } from '../routes.ts';
import { ColumnCount, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

/** 「图书馆」下面最多列几本在读的；全部在图书馆页里。 */
const READING_SHOWN = 6;
const FEED_ROUTE: Route = { view: 'feed', noteId: null };
const LIBRARY_ROUTE: Route = { view: 'books', noteId: null, bookId: null };

/** 打开过的书，最近读的在前。 */
export function readingBooks(books: readonly BookView[]): BookView[] {
  return books.filter((book) => book.progress !== null)
    .sort((a, b) => (b.progress?.updatedAt ?? '').localeCompare(a.progress?.updatedAt ?? ''))
    .slice(0, READING_SHOWN);
}

function Library({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const { books, error } = useBooksList();
  const bookId = route.view === 'books' ? route.bookId ?? null : null;
  const reading = books === null ? [] : readingBooks(books);
  return (
    <>
      <ColumnLabel>图书馆</ColumnLabel>
      {error === null ? null : <ColumnNote>{error}</ColumnNote>}
      <ColumnLink route={LIBRARY_ROUTE} current={route.view === 'books' && bookId === null} navigate={navigate}
        lead={<Icon name="library" size={16} />} trail={<ColumnCount value={books?.length ?? null} label="本" />}>
        全部图书
      </ColumnLink>
      {reading.map((book) => (
        <ColumnLink key={book.id} route={{ view: 'books', noteId: null, bookId: book.id }}
          current={bookId === book.id} navigate={navigate} lead={<Icon name="books" size={16} />}
          trail={<span className="column-count">{percentText(book.progress?.percent ?? 0)}</span>}>
          {book.title}
        </ColumnLink>
      ))}
    </>
  );
}

export function ReadingColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const { feedUi } = useClientState();
  const ui = useStore(feedUi.store);
  const { nav, error } = useFeedNav();
  const picker = useRef<HTMLInputElement>(null);
  const onList = route.view === 'feed' && route.feedItemId == null;
  const segment = segmentOf(ui);
  const toList = (): void => {
    if (!onList) navigate(FEED_ROUTE);
  };
  const show = (next: FeedSegment): void => {
    if (onList && segment === next && next === 'douyin') {
      feedUi.setDouyinOpen(true);
      return;
    }
    void live.feed.setSegment(next);
    toList();
  };
  return (
    <>
      <ColumnHead title="阅读">
        <IconButton icon="upload" label="导入书" onClick={() => picker.current?.click()} />
        <IconButton icon="plus" label="加来源" aria-haspopup="dialog" aria-expanded={ui.sourcesOpen}
          onClick={() => {
            toList();
            feedUi.openAdd();
          }} />
      </ColumnHead>
      <input ref={picker} type="file" accept={BOOK_FILE_EXTENSIONS.join(',')} multiple hidden
        aria-label="从阅读栏选择要导入的书" onChange={(event) => {
          const files = [...event.target.files ?? []];
          event.target.value = '';
          if (files.length === 0) return;
          queueBookImport(files);
          if (route.view !== 'books' || route.bookId != null) navigate(LIBRARY_ROUTE);
        }} />
      <div className="column-scroll">
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        <FeedSourceList nav={nav} segment={segment} onList={onList} onShow={show} allLabel="信息流"
          between={<Library route={route} navigate={navigate} />}
          onSettings={(row) => {
            toList();
            feedUi.setSettingsSource(row);
          }}
          onDouyin={() => {
            toList();
            feedUi.setDouyinOpen(true);
          }} />
      </div>
    </>
  );
}
