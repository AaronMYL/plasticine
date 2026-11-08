// 资料库栏目的第二栏（11-07 设计稿 Library-Space）：「空间」（Plasticine 写的报告、周报、核查、整理稿，类别色图标块）、
// 「文件」（工作目录最上一层的文件夹）、「图书」（在读的书和进度）。顶上 +：新空间跟 Plasticine 说（对话框展开）。
// 数据：GET /v2/spaces、GET /v2/files、GET /v2/books。手机上没有第二栏，「更多 · 空间」打开同一份列表的整页。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { BookView, FileEntryView, SpaceListItem } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { HueTile, type HueName } from '../hue.tsx';
import { IconButton } from '../icon-button.tsx';
import { Icon, type IconName } from '../icons.tsx';
import type { Route } from '../routes.ts';
import { ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

/** 图书一节最多列几本（在读的在前）；全部在图书馆里。 */
const BOOKS_SHOWN = 6;

export function spaceLook(space: SpaceListItem): { icon: IconName; hue: HueName } {
  if (space.kind === 'research') return { icon: 'space', hue: 'sky' };
  if (space.kind === 'review') return { icon: 'sparkle', hue: 'teal' };
  return { icon: 'file', hue: space.author === 'ai' ? 'sky' : 'sage' };
}

export interface LibraryData {
  spaces: SpaceListItem[] | null;
  folders: FileEntryView[] | null;
  books: BookView[] | null;
  error: string | null;
}

export function useLibraryData(): LibraryData {
  const api = useApi();
  const live = useLive();
  const [data, setData] = useState<LibraryData>({ spaces: null, folders: null, books: null, error: null });
  const [round, setRound] = useState(0);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'book.changed') {
      setRound((value) => value + 1);
    }
  }), [live.hub]);
  useEffect(() => {
    const controller = new AbortController();
    const fail = (cause: unknown): void => {
      if (!controller.signal.aborted) setData((previous) => ({ ...previous, error: errorText(cause) }));
    };
    api.spaces.list(controller.signal).then((result) => setData((previous) => ({ ...previous,
      spaces: result.spaces })), fail);
    api.files.list('', controller.signal).then((result) => setData((previous) => ({ ...previous,
      folders: result.entries.filter((entry) => entry.kind === 'directory') })), fail);
    api.books.list(controller.signal).then((result) => setData((previous) => ({ ...previous,
      books: result.books })), fail);
    return () => controller.abort();
  }, [api, round]);
  return data;
}

/** 在读的在前（按上次读的时间），没读过的在后。 */
function readingFirst(books: readonly BookView[]): BookView[] {
  return [...books].sort((a, b) => (b.progress?.updatedAt ?? '').localeCompare(a.progress?.updatedAt ?? ''));
}

export function SpaceRows({ spaces, current, navigate }: { spaces: readonly SpaceListItem[];
  current: string | null; navigate: (route: Route) => void }): ReactNode {
  return spaces.map((space) => {
    const look = spaceLook(space);
    return (
      <ColumnLink key={space.id} route={{ view: 'books', noteId: null, bookId: null, spaceId: space.id }}
        current={current === space.id} navigate={navigate} lead={<HueTile hue={look.hue} icon={look.icon} size={22} />}>
        {space.title}
      </ColumnLink>
    );
  });
}

export function LibraryColumn({ route, navigate, onAsk }: { route: Route; navigate: (route: Route) => void;
  onAsk: () => void }): ReactNode {
  const live = useLive();
  const data = useLibraryData();
  const spaceId = route.view === 'books' ? route.spaceId ?? null : null;
  const bookId = route.view === 'books' ? route.bookId ?? null : null;
  const openFolder = (path: string): void => {
    live.m5b.folder.set(path);
    void live.m5b.files.reset();
    navigate({ view: 'tools', noteId: null, tool: '文件' });
  };
  const books = data.books === null ? [] : readingFirst(data.books).slice(0, BOOKS_SHOWN);
  return (
    <>
      <ColumnHead title="资料库">
        <IconButton icon="plus" label="新空间：跟 Plasticine 说" onClick={onAsk} />
      </ColumnHead>
      <div className="column-scroll">
        {data.error === null ? null : <ColumnNote>{data.error}</ColumnNote>}
        {data.spaces === null || data.spaces.length === 0 ? null : <>
          <ColumnLabel>空间</ColumnLabel>
          <SpaceRows spaces={data.spaces} current={spaceId} navigate={navigate} />
        </>}
        {data.folders === null || data.folders.length === 0 ? null : <>
          <ColumnLabel>文件</ColumnLabel>
          {data.folders.map((folder) => (
            <button key={folder.path} type="button" className="column-item" onClick={() => openFolder(folder.path)}>
              <span className="column-item-lead"><Icon name="folder" size={16} /></span>
              <span className="column-item-text">{folder.name}</span>
            </button>
          ))}
        </>}
        <ColumnLabel>图书</ColumnLabel>
        <ColumnLink route={{ view: 'books', noteId: null, bookId: null }} current={route.view === 'books'
          && spaceId === null && bookId === null && route.spacesList !== true} navigate={navigate}
          lead={<Icon name="library" size={16} />}>图书馆</ColumnLink>
        {books.map((book) => (
          <ColumnLink key={book.id} route={{ view: 'books', noteId: null, bookId: book.id }}
            current={bookId === book.id} navigate={navigate} lead={<Icon name="books" size={16} />}
            trail={book.progress === null ? undefined
              : <span className="column-count">{Math.round(book.progress.percent * 100)}%</span>}>
            {book.title}
          </ColumnLink>
        ))}
      </div>
    </>
  );
}
