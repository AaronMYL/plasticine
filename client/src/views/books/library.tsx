// 图书馆：页头「图书馆」（11-08 图书单独一栏后和第二栏第一行同名）+「n 本 · 在读 n · 标注 n」，排序（最近 / 书名 / 作者）和「导入书」；导入中的书一行一个状态；
// 「在读」两列（封面、章、进度、上次在哪台设备读、接着读）；「全部」封面格子。整页可以把书拖进来。

import { StatusGlyph } from '../../shell/glyph.tsx';
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { BOOK_FILE_EXTENSIONS, type BookView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { useDismiss } from '../../shell/use-dismiss.ts';
import { RenameField } from '../../shell/rename-field.tsx';
import { useDeleteConfirm } from '../library/library-actions.tsx';
import { libraryChanged } from '../library/library-signal.ts';
import type { Route } from '../../shell/routes.ts';
import { BookCover } from './book-cover.tsx';
import { chapterDotted, isReading, percentText, progressLabel, readingTime } from './book-format.ts';
import { sizeText, useBookImports, type ImportRow } from './book-import.ts';
import { onQueuedBookImport } from './import-queue.ts';
import { SORT_LABELS, sortBooks, type LibrarySort } from './library-sort.ts';

export interface LibraryProps {
  phone: boolean;
  navigate: (route: Route) => void;
}

function useLibrary(): { books: BookView[] | null; error: string | null; reload: () => void } {
  const api = useApi();
  const live = useLive();
  const [books, setBooks] = useState<BookView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((count) => count + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    api.books.list(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setBooks(result.books);
        setError(null);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorText(cause));
      }
    });
    return () => controller.abort();
  }, [api, generation]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'book.changed' && event.part !== 'insights' || event.type === 'resync') {
      reload();
    }
  }), [live.hub, reload]);
  return { books, error, reload };
}

function ImportRows({ rows, onRetry, onDismiss }: {
  rows: readonly ImportRow[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}): ReactNode {
  if (rows.length === 0) {
    return null;
  }
  return (
    <ul className="bk-imports" aria-label="正在导入的书">
      {rows.map((row) => (
        <li key={row.id} className="bk-import" data-status={row.status}>
          <span className={row.status === 'failed' ? 'dot dot-err' : 'dot dot-run'} aria-hidden="true" />
          {row.status === 'uploading' ? <>
            <span className="bk-import-name">正在导入 <b>{row.fileName}</b></span>
            <span className="text-meta bk-import-meta">{sizeText(row.bytes)} · 上传中</span>
          </> : <>
            <span className="bk-import-name">{row.status === 'failed' ? '没导进来' : '没等到回执'} <b>{row.fileName}</b>
              <span className={row.status === 'failed' ? 'bk-import-error' : 'bk-import-note'} role="alert">
                {row.message}</span></span>
            {row.status === 'uncertain' ? <button type="button" className="text-button"
              onClick={() => onRetry(row.id)}>再核实</button> : null}
            <button type="button" className="text-button text-button-quiet" onClick={() => onDismiss(row.id)}>
              知道了</button>
          </>}
        </li>
      ))}
    </ul>
  );
}

function ReadingRow({ book, now, onOpen }: { book: BookView; now: Date; onOpen: () => void }): ReactNode {
  const progress = book.progress;
  const where = progress === null ? '' : chapterDotted(book.toc[progress.chapter]?.title ?? '');
  return (
    <div className="bk-reading">
      <button type="button" className="bk-cover-button" aria-label={`打开《${book.title}》`} onClick={onOpen}>
        <BookCover book={book} />
      </button>
      <div className="bk-reading-text">
        {/* 2026-11-03《全量界面优化》：作者在封面上，不再写一遍；标注是图标 + 数（悬停提示「标注 n」）。11-04 重做
            悬停：上次读的时间和设备一起常显（「昨天 22:40 · iPhone」，接着读先知道在哪停的）。 */}
        <span className="bk-title">{book.title}</span>
        {where === '' ? null : <span className="bk-where">{where}</span>}
        <div className="bk-progress-row">
          <div className="bk-progress" aria-hidden="true">
            <i style={{ width: percentText(progress?.percent ?? 0) }} />
          </div>
          {progress === null ? null : <>
            <span className="text-mono bk-reading-meta">{percentText(progress.percent)}</span>
            <time className="text-meta bk-reading-meta" dateTime={progress.updatedAt}>
              {readingTime(progress.updatedAt, now)} · {progress.deviceLabel}</time>
          </>}
        </div>
        <div className="bk-reading-foot">
          <button type="button" className="primary-button" onClick={onOpen}>接着读</button>
          {book.annotationCount === 0 ? null
            : <span className="bk-count text-mono" data-tip={`标注 ${book.annotationCount}`}>
            <Icon name="quote" size={12} /><span className="sr-only">标注 </span>{book.annotationCount}</span>}
        </div>
      </div>
    </div>
  );
}

interface GridItemProps {
  book: BookView;
  onOpen: () => void;
  onDeleted: () => void;
}

function GridItem({ book, onOpen, onDeleted }: GridItemProps): ReactNode {
  const api = useApi();
  const [menu, setMenu] = useState<'closed' | 'open'>('closed');
  const [renaming, setRenaming] = useState(false);
  const confirm = useDeleteConfirm();
  const item = useRef<HTMLLIElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  // 点外面、Esc、窗口失焦、切页、缩放、滚动都收（use-dismiss.ts）。
  useDismiss({ open: menu !== 'closed', inside: [item], anchor: more, onDismiss: (reason) => {
    setMenu('closed');
    if (reason === 'escape') {
      more.current?.focus();
    }
  } });
  // 2026-11-08：删了进资料库「最近删除」，能还原；删前照全站一样先问。
  const remove = (): void => {
    setMenu('closed');
    confirm.ask(book.title, async () => {
      await api.books.remove(book.id, createRequestId());
      libraryChanged();
    }, onDeleted);
  };
  const rename = async (title: string): Promise<void> => {
    await api.books.rename(book.id, { requestId: createRequestId(), title });
    libraryChanged();
    onDeleted();
  };
  return (
    <li className="bk-item" ref={item}>
      <button type="button" className="bk-cover-button" aria-label={`打开《${book.title}》`} onClick={onOpen}>
        <BookCover book={book} />
      </button>
      {renaming ? <span className="bk-item-title">
        <RenameField value={book.title} label={`《${book.title}》的新书名`} onSave={rename}
          onDone={() => setRenaming(false)} />
      </span> : <span className="bk-item-title">{book.title}</span>}
      <IconButton ref={more} icon="more" label={`《${book.title}》的更多操作`} className="bk-item-more"
        aria-expanded={menu !== 'closed'} onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')} />
      <span className="bk-item-meta">
        {progressLabel(book) === '未读' ? null : <span className="bk-item-progress">{progressLabel(book) === '读完'
          ? <StatusGlyph status="done" label="读完" /> : progressLabel(book)}</span>}
      </span>
      {menu === 'closed' ? null : (
        <div className="bk-item-menu" role="menu" aria-label={`《${book.title}》`}>
          <button type="button" role="menuitem" className="bk-menu-item" onClick={() => {
            setMenu('closed');
            setRenaming(true);
          }}>
            <Icon name="edit" /> 改名
          </button>
          <button type="button" role="menuitem" className="bk-menu-item is-danger" onClick={remove}>
            <Icon name="trash" /> 删除
          </button>
        </div>
      )}
      {confirm.dialog}
    </li>
  );
}

const ACCEPT = BOOK_FILE_EXTENSIONS.join(',');

export function Library({ phone, navigate }: LibraryProps): ReactNode {
  const api = useApi();
  const { books, error, reload } = useLibrary();
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const open = (book: BookView): void => navigate({ view: 'books', noteId: null, bookId: book.id });
  const imports = useBookImports(api.books, (book, duplicate) => {
    reload();
    if (duplicate) {
      open(book);
    }
  });
  // 图书第二栏栏头「导入书」选的文件交到这里导入（进度和出错都在这页上）。
  const { importFiles } = imports;
  useEffect(() => onQueuedBookImport(importFiles), [importFiles]);
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    imports.importFiles([...event.dataTransfer.files]);
  };
  const sorted = books === null ? [] : sortBooks(books, sort);
  const reading = sorted.filter(isReading);
  const now = new Date();
  const controls = phone ? (
    <IconButton icon="upload" label="导入书" size={17} onClick={() => picker.current?.click()} />
  ) : <>
    <div className="segmented" role="group" aria-label="排序">
      {(Object.keys(SORT_LABELS) as LibrarySort[]).map((value) => (
        <button key={value} type="button" className="segmented-item" aria-pressed={sort === value}
          onClick={() => setSort(value)}>{SORT_LABELS[value]}</button>
      ))}
    </div>
    <button type="button" className="chip-button bk-import-button" onClick={() => picker.current?.click()}>
      <Icon name="upload" /> 导入书</button>
  </>;
  return (
    <div className={phone ? 'page bk-library bk-phone' : 'page bk-library'} data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}>
      <PageHeader title="图书馆" controls={controls} />
      <input ref={picker} type="file" accept={ACCEPT} multiple hidden aria-label="选择要导入的书"
        onChange={(event) => {
          imports.importFiles([...event.target.files ?? []]);
          event.target.value = '';
        }} />
      <ImportRows rows={imports.rows} onRetry={imports.retry} onDismiss={imports.dismiss} />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {books === null && error === null ? <p className="block-empty">正在读…</p> : null}
      {reading.length === 0 ? null : (
        <section className="block" aria-label="在读">
          <div className="block-head"><h2 className="block-title">在读</h2>
            <span className="block-meta text-meta">{reading.length}</span></div>
          <div className="bk-reading-list">
            {reading.map((book) => <ReadingRow key={book.id} book={book} now={now} onOpen={() => open(book)} />)}
          </div>
        </section>
      )}
      {books === null ? null : (
        <section className="block" aria-label="全部">
          <div className="block-head"><h2 className="block-title">全部</h2>
            <span className="block-meta text-meta">{books.length}</span></div>
          {books.length === 0 ? <p className="block-empty">图书馆还是空的，点「导入书」或者把书拖进这页。</p> : (
            <ul className="bk-grid">
              {sorted.map((book) => (
                <GridItem key={book.id} book={book} onOpen={() => open(book)} onDeleted={reload} />
              ))}
            </ul>
          )}

        </section>
      )}
    </div>
  );
}
