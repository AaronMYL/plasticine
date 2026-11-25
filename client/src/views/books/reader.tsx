import { currentComposer } from '../conversation/current-composer.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties,
  type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { useLive } from '../../live.tsx';
import type { BookAnnotationView, BookChapterResponse, BookProgressView, BookView } from '../../api/shared.ts';
import type { BookRoutePosition, Route } from '../../shell/routes.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { AnnotationActions } from './annotation-actions.ts';
import { BookSheet, type SheetTab } from './book-sheet.tsx';
import { bookPercent, minutesToRead, percentText } from './book-format.ts';
import { buildBookQuote, openConversation } from './book-quote.ts';
import { ChapterView, type FlashMark } from './chapter-view.tsx';
import { MOTION, play } from '../../shell/motion.ts';
import { currentDeviceLabel } from './device-label.ts';
import { MarginNotes, marginItemsOf, type MarginItem } from './margin-notes.tsx';
import { sizeColumns } from './page-surface.ts';
import { PageZones } from './page-zones.tsx';
import { PopoverLayer, type PopoverState } from './popover-layer.tsx';
import { ProgressSaver } from './progress-saver.ts';
import { OtherDeviceBanner, ReaderBar, type ReaderPanel } from './reader-bar.tsx';
import { chapterDecorations, htmlText, keyPointMarks, sentenceEnd } from './reader-decorations.ts';
import { ReaderFooter } from './reader-footer.tsx';
import { loadKeyPointsShown, loadLocalPosition, loadReadingMode, loadTypography, saveKeyPointsShown,
  saveReadingMode, saveTypography, typeMetrics, type ReadingMode, type Typography } from './reader-prefs.ts';
import { otherDeviceAhead, startPosition } from './reading-position.ts';
import { elementRects, offsetAtTop, rectIn, scrollToOffset } from './reading-scroll.ts';
import { SearchSheet } from './search-sheet.tsx';
import { plainText } from './text-offsets.ts';
import { TocSheet } from './toc-sheet.tsx';
import { TypographyMenu } from './typography-menu.tsx';
import { useAnnotations, useBook, useInsight } from './use-book-data.ts';
import { usePaged } from './use-paged.ts';
import { useSelectionPopover, useSelectionQuote } from './use-selection-popover.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { usePageWidth } from './use-page-width.ts';

const HEADING_FIRST = /^<h[234]>/;

export interface ReaderProps {
  bookId: string;
  position: BookRoutePosition | null;
  phone: boolean;
  navigate: (route: Route) => void;
}

const MARGIN_MIN_WIDTH = 920;
const FLASH_MS = 1_600;
const CHAPTER_SLIDE = 24;

type Target = number | 'end';

interface Jump {
  chapter: number;
  start: number;
  end?: number;
}

export function Reader(props: ReaderProps): ReactNode {
  const book = useBook(props.bookId);
  if (book.error !== null && book.value === null) {
    return (
      <div className="page">
        <p className="block-empty is-error" role="alert">{book.error}</p>
        <button type="button" className="text-button" onClick={() => props.navigate({ view: 'books', noteId: null })}>
          回到图书馆
        </button>
      </div>
    );
  }
  if (book.value === null) {
    return <PageLoading page rows={8} />;
  }
  return <LoadedReader {...props} book={book.value} />;
}

function LoadedReader({ book, position, phone, navigate }: ReaderProps & { book: BookView }): ReactNode {
  const api = useApi();
  const { chapters, hub } = useLive();
  const targetState = useClientState();
  const { shellPrefs } = targetState;
  const annotations = useAnnotations(book.id);
  const keyPoints = useInsight(book.id, 'key_points');
  const deviceLabel = useMemo(currentDeviceLabel, []);
  const saver = useMemo(() => new ProgressSaver(api.books, book.id, deviceLabel), [api, book.id, deviceLabel]);
  const sync = useStore(saver.state);
  const [start] = useState(() => {
    const local = loadLocalPosition(book.id);
    return { at: startPosition(position, local, book.progress),
      banner: position === null ? otherDeviceAhead(book.progress, local, deviceLabel) : null };
  });
  const [chapterIndex, setChapterIndex] = useState(() => Math.min(start.at.chapter, book.toc.length - 1));
  const [chapter, setChapter] = useState<BookChapterResponse | null>(() => chapters.peek(book.id, chapterIndex));
  const [chapterGeneration, setChapterGeneration] = useState(0);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [banner, setBanner] = useState<BookProgressView | null>(start.banner);
  const [percent, setPercent] = useState(() => bookPercent(book.toc, start.at.chapter, start.at.offset));
  const [panel, setPanel] = useState<ReaderPanel | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab>('annotations');
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [typography, setTypography] = useState<Typography>(() => loadTypography(phone));
  const [mode, setMode] = useState<ReadingMode>(loadReadingMode);
  const paged = mode === 'paged';
  const [keyPointsShown, setKeyPointsShown] = useState(() => loadKeyPointsShown(book.id));
  const [flash, setFlash] = useState<FlashMark | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const [textBox, setTextBox] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const rootChapter = useRef<number | null>(null);
  const pending = useRef<Target | null>(start.at.offset);
  const edge = useRef<1 | -1 | null>(null);
  const flashTarget = useRef<Jump | null>(position === null ? null
    : { chapter: position.chapter, start: position.offset });
  const [jumpCount, setJumpCount] = useState(0);
  const nonce = useRef(0);
  const pageWidth = usePageWidth(page);

  useEffect(() => {
    const controller = new AbortController();
    setChapterError(null);
    chapters.load(book.id, chapterIndex, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setChapter(next);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setChapterError(errorText(cause));
      }
    });
    return () => controller.abort();
  }, [chapters, book.id, chapterIndex, chapterGeneration]);

  useEffect(() => hub.on((event) => {
    if (event.type === 'resync'
      || (event.type === 'book.changed' && event.bookId === book.id && event.part === 'book')) {
      setChapterGeneration((value) => value + 1);
    }
  }), [hub, book.id]);

  useEffect(() => {
    const flush = (): void => void saver.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
      saver.dispose();
    };
  }, [saver]);

  const chapterText = useMemo(() => (chapter === null ? '' : htmlText(chapter.html)), [chapter]);
  const annotationList = useMemo(() => annotations.value ?? [], [annotations.value]);
  const decorations = useMemo(() => chapterDecorations({ chapter: chapterIndex, text: chapterText,
    annotations: annotationList, keyPoints: keyPoints.value, showKeyPoints: keyPointsShown }),
  [chapterIndex, chapterText, annotationList, keyPoints.value, keyPointsShown]);
  const pointMarks = useMemo(() => keyPointMarks(decorations.keyPoints), [decorations.keyPoints]);
  const showMargins = !phone && !paged && pageWidth >= MARGIN_MIN_WIDTH;
  const actions = useMemo(() => new AnnotationActions(api.books, book.id, annotations.reload),
    [api, book.id, annotations.reload]);
  const chapterTitle = book.toc[chapterIndex]?.title ?? chapter?.title ?? '';

  const save = useCallback((offset: number): void => {
    const next = bookPercent(book.toc, chapterIndex, offset);
    setPercent(next);
    saver.update({ chapter: chapterIndex, offset, percent: next });
  }, [book.toc, chapterIndex, saver]);

  const programmatic = useRef(false);
  const restoring = useRef(true);
  const paging = usePaged({
    enabled: paged, stage: page, sheet, text: textBox, root: rootRef,
    busy: () => panel !== null || popover !== null,
    onTurnStart: () => setPopover(null),
    onTurned: (offset) => save(offset),
    onEdge: (direction) => {
      const next = chapterIndex + direction;
      if (next < 0 || next >= book.toc.length) {
        return;
      }
      edge.current = direction;
      pending.current = direction === 1 ? 0 : 'end';
      setPopover(null);
      setChapter(chapters.peek(book.id, next));
      setChapterIndex(next);
    },
  });
  const { paginator } = paging;

  const place = useCallback((container: HTMLElement, target: Target): void => {
    let offset: number;
    if (paged) {
      if (paginator === null || sheet === null || textBox === null) {
        return;
      }
      sizeColumns(sheet, textBox);
      offset = paginator.showOffset(target);
    } else {
      if (page === null) {
        return;
      }
      offset = target === 'end' ? plainText(container).length : target;
      programmatic.current = true;
      if (target === 'end') {
        page.scrollTop = page.scrollHeight;
      } else {
        scrollToOffset(container, page, offset);
      }
      requestAnimationFrame(() => {
        programmatic.current = false;
      });
    }
    if (restoring.current) {
      restoring.current = false;
      setPercent(bookPercent(book.toc, chapterIndex, offset));
    } else {
      save(offset);
    }
  }, [paged, paginator, sheet, textBox, page, save, book.toc, chapterIndex]);
  const placeRef = useRef(place);
  placeRef.current = place;

  const onScroll = (): void => {
    if (paged || root === null || page === null || programmatic.current) {
      return;
    }
    save(offsetAtTop(root, page));
  };

  const onRendered = useCallback((container: HTMLElement): void => {
    rootRef.current = container;
    rootChapter.current = chapterIndex;
    setRoot(container);
    setLayoutKey((count) => count + 1);
    const target = pending.current;
    if (target !== null && (!paged || paginator !== null)) {
      pending.current = null;
      place(container, target);
    } else if (paged && paginator !== null && sheet !== null && textBox !== null) {
      sizeColumns(sheet, textBox);
      paginator.relayout();
    }
    const from = edge.current;
    edge.current = null;
    if (from !== null) {
      play(textBox, [{ opacity: 0, transform: `translateX(${from * CHAPTER_SLIDE}px)` },
        { opacity: 1, transform: 'translateX(0)' }], MOTION.base);
    }
  }, [place, paged, paginator, sheet, textBox, chapterIndex]);

  useLayoutEffect(() => {
    const container = rootRef.current;
    const target = pending.current;
    const ready = container !== null && rootChapter.current === chapterIndex && (!paged || paginator !== null);
    if (!ready || target === null) {
      return;
    }
    pending.current = null;
    placeRef.current(container, target);
  }, [paged, paginator, chapterIndex]);

  useLayoutEffect(() => {
    if (paged && paginator !== null && sheet !== null && textBox !== null && rootRef.current !== null) {
      sizeColumns(sheet, textBox);
      paginator.relayout();
    }
  }, [typography, paged, paginator, sheet, textBox]);

  useEffect(() => {
    if (!paged || root === null || paginator === null) {
      return undefined;
    }
    const relayout = (event: Event): void => {
      if (event.target instanceof HTMLImageElement) {
        paginator.relayout();
      }
    };
    root.addEventListener('load', relayout, true);
    return () => root.removeEventListener('load', relayout, true);
  }, [paged, root, paginator]);

  const jumpTo = useCallback((jump: Jump): void => {
    if (phone || (panel !== 'insights' && panel !== 'annotations')) setPanel(null);
    setPopover(null);
    setBanner(null);
    pending.current = jump.start;
    if (jump.chapter !== chapterIndex) {
      setChapter(chapters.peek(book.id, jump.chapter));
      setChapterIndex(jump.chapter);
    } else if (root !== null) {
      pending.current = null;
      place(root, jump.start);
    }
    if (jump.start > 0 || jump.end !== undefined) {
      flashTarget.current = jump;
      setJumpCount((count) => count + 1);
    }
  }, [chapterIndex, root, place, chapters, book.id, phone, panel]);

  useEffect(() => {
    const jump = flashTarget.current;
    if (jump === null || chapter === null || chapter.index !== jump.chapter) {
      return;
    }
    flashTarget.current = null;
    nonce.current += 1;
    setFlash({ start: jump.start, end: jump.end ?? sentenceEnd(chapterText, jump.start), nonce: nonce.current });
  }, [jumpCount, chapter, chapterText]);

  useEffect(() => {
    if (flash === null) {
      return undefined;
    }
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const overlay = useRef<HTMLElement | null>(null);
  overlay.current = paged ? page : textBox;
  useSelectionPopover(root, overlay, setPopover);

  const quoteRange = (from: number, to: number, chapterAt = chapterIndex, text = chapterText.slice(from, to)): void => {
    try {
      currentComposer(targetState).ui.addQuote(buildBookQuote({ bookId: book.id, bookTitle: book.title,
        chapter: chapterAt,
        chapterTitle: book.toc[chapterAt]?.title ?? '', start: from, end: to, text }));
      openConversation(shellPrefs, phone);
    } catch (cause) {
      setChapterError(errorText(cause));
    }
  };
  const quoteAnnotation = (annotation: BookAnnotationView): void => {
    setPanel(null);
    const mark = decorations.highlights.find((item) => item.id === annotation.id);
    if (mark !== undefined) {
      quoteRange(mark.start, mark.end);
    } else {
      quoteRange(annotation.start, annotation.end, annotation.chapter, annotation.quote);
    }
  };
  useSelectionQuote(root, chapter !== null, setPopover, quoteRange);
  const openAt = (element: HTMLElement): { top: number; bottom: number; left: number } =>
    overlay.current === null ? { top: 0, bottom: 0, left: 0 } : rectIn(overlay.current, elementRects(element));
  const changeMode = (next: ReadingMode): void => {
    if (next === mode) {
      return;
    }
    const container = rootRef.current;
    if (container !== null) {
      pending.current = paged ? paginator?.anchor ?? 0 : page === null ? 0 : offsetAtTop(container, page);
    }
    if (page !== null) {
      page.scrollTop = 0;
    }
    if (sheet !== null) {
      sheet.scrollLeft = 0;
    }
    setPopover(null);
    setMode(next);
    saveReadingMode(next);
  };
  const changeTypography = (next: Typography): void => {
    setTypography(next);
    saveTypography(next);
  };
  const changeKeyPointsShown = (shown: boolean): void => {
    setKeyPointsShown(shown);
    saveKeyPointsShown(book.id, shown);
  };
  const openPanel = (next: ReaderPanel): void => {
    if (next === 'annotations' || next === 'insights') {
      setSheetTab(next === 'annotations' ? 'annotations' : 'outline');
    }
    setPanel((current) => (current === next && next === 'type' ? null : next));
  };
  const marginItems = useMemo((): MarginItem[] => (!showMargins ? [] : marginItemsOf({
    highlights: decorations.highlights, keyPoints: decorations.keyPoints, annotations: annotationList,
    onAccept: (point) => void actions.accept(point.pointId, point, chapterText, deviceLabel)
      .catch((cause: unknown) => setChapterError(errorText(cause))),
    onDismiss: (point) => void actions.dismiss(point.pointId).then(keyPoints.reload,
      (cause: unknown) => setChapterError(errorText(cause))),
  })), [showMargins, decorations, annotationList, actions, chapterText, deviceLabel, keyPoints.reload]);
  const metrics = typeMetrics(typography);
  const typeStyle = { '--read-size': `${metrics.fontSize}px`,
    '--read-leading': `${metrics.lineHeight}px` } as CSSProperties;
  const bannerChapter = banner === null ? '' : book.toc[banner.chapter]?.title ?? '';
  const popoverLayer = popover === null || chapter === null ? null : (
    <PopoverLayer key={`${popover.kind}:${JSON.stringify(popover.rect)}`} popover={popover}
      chapter={chapterIndex} chapterText={chapterText} deviceLabel={deviceLabel} annotations={annotationList}
      keyPoints={decorations.keyPoints} actions={actions} onChange={setPopover} onQuote={quoteRange}
      onDone={() => document.getSelection()?.removeAllRanges()} onDismissed={keyPoints.reload} />
  );

  return (
    <div className={phone ? 'bk-reader bk-phone-reader' : 'bk-reader'} data-margins={showMargins}
      data-insight-open={!phone && (panel === 'insights' || panel === 'annotations') || undefined}>
      <ReaderBar title={book.title} author={book.author} chapterTitle={chapterTitle} phone={phone}
        annotationCount={annotations.value?.length ?? book.annotationCount}
        onBack={() => navigate({ view: 'books', noteId: null })} onOpen={openPanel} />
      {panel === 'type' ? <TypographyMenu value={typography} mode={mode} onChange={changeTypography}
        onMode={changeMode} onClose={() => setPanel(null)} /> : null}
      {banner === null ? null : <OtherDeviceBanner progress={banner} chapterTitle={bannerChapter} now={new Date()}
        onStay={() => setBanner(null)} onJump={() => jumpTo({ chapter: banner.chapter, start: banner.offset })} />}
      <div ref={setPage} className="bk-page" data-mode={mode} onScroll={onScroll}>
        <div ref={setSheet} className="bk-sheet">
        <div ref={setTextBox} className="bk-text" style={typeStyle}>
          {chapter !== null && HEADING_FIRST.test(chapter.html) ? null
            : <h2 className="bk-chapter-title">{chapterTitle}</h2>}
          <p className="bk-chapter-meta text-meta">
            本章约 {minutesToRead(book.toc[chapterIndex]?.chars ?? 0)} 分钟 · 全书 {percentText(percent)}
          </p>
          {chapterError === null ? null : <p className="block-empty is-error" role="alert">{chapterError}</p>}
          {chapter === null ? (chapterError === null ? <PageLoading rows={10} /> : null) : (
            <ChapterView html={chapter.html} assetUrl={(key) => api.books.assetUrl(chapter, key)}
              highlights={decorations.highlights} keyPoints={pointMarks} noteMarkers={!showMargins} flash={flash}
              onRendered={onRendered}
              onHighlight={(id, element) => setPopover({ kind: 'highlight', annotationId: id, rect: openAt(element) })}
              onKeyPoint={(pointId, element) => setPopover({ kind: 'key-point', pointId, rect: openAt(element) })} />
          )}
          {paged ? null : popoverLayer}
          <MarginNotes items={marginItems} root={root} layoutKey={layoutKey} />
          {paged ? null : <nav className="bk-chapter-nav" aria-label="翻章">
            {chapterIndex > 0 ? <button type="button" className="chip-button"
              onClick={() => jumpTo({ chapter: chapterIndex - 1, start: 0 })}>
              ‹ 上一章 · {book.toc[chapterIndex - 1]?.title}</button> : <span />}
            {chapterIndex < book.toc.length - 1 ? <button type="button" className="chip-button"
              onClick={() => jumpTo({ chapter: chapterIndex + 1, start: 0 })}>
              下一章 · {book.toc[chapterIndex + 1]?.title} ›</button> : <span className="text-meta">全书完</span>}
          </nav>}
        </div>
        </div>
        {paged ? popoverLayer : null}
        {paged ? <PageZones hover={paging.hover} onTurn={paging.turn} /> : null}
      </div>
      <ReaderFooter percent={percent} sync={sync} />
      <TocSheet open={panel === 'toc'} phone={phone} title={book.title} toc={book.toc} current={chapterIndex}
        onClose={() => setPanel(null)} onPick={(index) => jumpTo({ chapter: index, start: 0 })} />
      <SearchSheet open={panel === 'search'} phone={phone} bookId={book.id} title={book.title}
        onClose={() => setPanel(null)}
        onPick={(hit) => jumpTo({ chapter: hit.chapter, start: hit.start, end: hit.end })} />
      <BookSheet open={panel === 'annotations' || panel === 'insights'} tab={sheetTab} phone={phone} book={book}
        annotations={annotationList} keyPoints={keyPoints} unanchored={decorations.unanchored}
        currentChapter={chapterIndex} keyPointsShown={keyPointsShown} now={new Date()} onTab={setSheetTab}
        onClose={() => setPanel(null)} onKeyPointsShown={changeKeyPointsShown} onJump={jumpTo}
        onQuote={quoteAnnotation} onExported={(noteId) => navigate({ view: 'notes', noteId })}
        onOpenMessage={(discussion) => navigate({ view: 'conversation', noteId: null,
          messageId: discussion.messageId })} />
    </div>
  );
}
