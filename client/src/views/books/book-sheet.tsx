// 「<书名> · 标注与讨论」浮层（原语 7：电脑上浮在主区里，手机是底部抽屉）。分段控件四段：标注 n / 讨论 n / 大纲 / 重点。
// 标注和重点由阅读页传进来（正文上也要用）；讨论和大纲打开浮层时才读。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { BookAnnotationView, BookDiscussion, BookInsightKind, BookInsightView, BookKeyPoint,
  BookView } from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { AnnotationsTab } from './annotations-tab.tsx';
import { DiscussionsTab } from './discussions-tab.tsx';
import { KeyPointsTab, OutlineTab } from './insight-tabs.tsx';
import { useDiscussions, useInsight, type Loaded } from './use-book-data.ts';

export type SheetTab = 'annotations' | 'discussions' | 'outline' | 'key_points';

export interface BookSheetProps {
  open: boolean;
  tab: SheetTab;
  phone: boolean;
  book: BookView;
  annotations: readonly BookAnnotationView[];
  keyPoints: Loaded<BookInsightView>;
  unanchored: ReadonlySet<string>;
  currentChapter: number;
  keyPointsShown: boolean;
  now: Date;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  onKeyPointsShown: (shown: boolean) => void;
  onJump: (position: { chapter: number; start: number; end?: number }) => void;
  onQuote: (annotation: BookAnnotationView) => void;
  onOpenMessage: (discussion: BookDiscussion) => void;
  onExported: (noteId: string) => void;
}

function useInsightActions(bookId: string): {
  errors: Partial<Record<BookInsightKind, string>>;
  generate: (kind: BookInsightKind, force: boolean, after: () => void) => void;
} {
  const api = useApi();
  const [errors, setErrors] = useState<Partial<Record<BookInsightKind, string>>>({});
  const generate = (kind: BookInsightKind, force: boolean, after: () => void): void => {
    setErrors((current) => ({ ...current, [kind]: undefined }));
    api.books.generateInsight(bookId, { requestId: createRequestId(), kind, force }).then(after, (cause: unknown) => {
      setErrors((current) => ({ ...current, [kind]: errorText(cause) }));
    });
  };
  return { errors, generate };
}

export function BookSheet(props: BookSheetProps): ReactNode {
  const api = useApi();
  const { book } = props;
  const discussions = useDiscussions(book.id, props.open);
  const outline = useInsight(book.id, 'outline', props.open);
  const insights = useInsightActions(book.id);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportNotes = (): void => {
    setExporting(true);
    setExportError(null);
    api.books.exportNotes(book.id, createRequestId()).then((result) => {
      setExporting(false);
      props.onExported(result.noteId);
    }, (cause: unknown) => {
      setExporting(false);
      setExportError(errorText(cause));
    });
  };
  const jumpToPoint = (point: BookKeyPoint): void => {
    const first = point.anchors[0];
    if (first !== undefined) {
      props.onJump({ chapter: first.chapter, start: first.start, end: first.end });
    }
  };
  const tabs: { id: SheetTab; label: string }[] = [
    { id: 'annotations', label: `标注 ${props.annotations.length}` },
    { id: 'discussions', label: discussions.value === null ? '讨论' : `讨论 ${discussions.value.length}` },
    { id: 'outline', label: '大纲' },
    { id: 'key_points', label: '重点' },
  ];
  const body = ((): ReactNode => {
    switch (props.tab) {
      case 'annotations':
        return <AnnotationsTab annotations={props.annotations} toc={book.toc} unanchored={props.unanchored}
          now={props.now} exporting={exporting} exportError={exportError} onExport={exportNotes}
          onQuote={props.onQuote}
          onJump={(annotation) => props.onJump({ chapter: annotation.chapter, start: annotation.start,
            end: annotation.end })} />;
      case 'discussions':
        return <DiscussionsTab discussions={discussions.value} error={discussions.error} toc={book.toc} now={props.now}
          onOpen={props.onOpenMessage}
          onJump={(discussion) => props.onJump({ chapter: discussion.chapter, start: discussion.start })} />;
      case 'outline':
        return <OutlineTab kind="outline" insight={outline.value} loadError={outline.error}
          actionError={insights.errors.outline ?? null} toc={book.toc} currentChapter={props.currentChapter}
          now={props.now} onGenerate={(force) => insights.generate('outline', force, outline.reload)}
          onJump={(chapter) => props.onJump({ chapter, start: 0 })} />;
      case 'key_points':
        return <KeyPointsTab kind="key_points" insight={props.keyPoints.value} loadError={props.keyPoints.error}
          actionError={insights.errors.key_points ?? null} toc={book.toc} annotations={props.annotations}
          shown={props.keyPointsShown} now={props.now} onShownChange={props.onKeyPointsShown}
          onGenerate={(force) => insights.generate('key_points', force, props.keyPoints.reload)}
          onJump={jumpToPoint} />;
    }
  })();
  return (
    <Sheet open={props.open} variant={props.phone ? 'drawer' : 'panel'} title={`${book.title} · 标注与讨论`}
      onClose={props.onClose}>
      <div className="bk-sheet">
        <div className="segmented bk-sheet-tabs" role="group" aria-label="标注与讨论的分页">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className="segmented-item" aria-pressed={props.tab === tab.id}
              onClick={() => props.onTab(tab.id)}>{tab.label}</button>
          ))}
        </div>
        {body}
      </div>
    </Sheet>
  );
}
