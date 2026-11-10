import type { ReactNode } from 'react';
import type { BookAnnotationView, BookInsightKind, BookInsightView, BookKeyPoint,
  BookTocEntry } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { SpaceFrame } from '../spaces/space-frame.tsx';
import { letterDate } from '../spaces/space-time.ts';
import { useLinkedSpace } from '../spaces/use-linked-space.ts';
import '../spaces/space-frame.css';

const KIND_NAMES: Readonly<Record<BookInsightKind, string>> = { outline: '大纲', key_points: '重点' };

export interface InsightStateProps {
  bookId: string;
  kind: BookInsightKind;
  insight: BookInsightView | null;
  loadError: string | null;
  actionError: string | null;
  onGenerate: (force: boolean) => void;
}

function InsightContent(props: InsightStateProps & { currentChapter?: number; tools?: ReactNode;
  onPosition: (chapter: number, offset: number) => void }): ReactNode {
  const { value: space, error, reload } = useLinkedSpace(props.insight?.spaceId ?? null);
  const name = KIND_NAMES[props.kind];
  const status = props.insight?.status;
  const failure = props.loadError ?? props.actionError ?? error;
  let body: ReactNode;
  if (failure !== null) {
    body = <p className="block-empty is-error" role="alert">{failure}{' '}
      <button type="button" className="text-button" onClick={reload}>重新读取</button></p>;
  } else if (status === 'generating') {
    body = <p className="bk-generating" role="status">Plasticine 正在逐章归纳…</p>;
  } else if (status === 'failed') {
    body = <div className="bk-insight-empty"><p role="alert">{props.insight?.error}</p>
      <button type="button" className="primary-button" onClick={() => props.onGenerate(true)}>再试一次</button></div>;
  } else if (status === 'none') {
    body = <div className="bk-insight-empty"><button type="button" className="primary-button"
      onClick={() => props.onGenerate(false)}>生成{name}</button></div>;
  } else if (status === 'ready' && props.insight?.spaceId == null) {
    body = <p className="block-empty">这份图书笔记已不在资料库中。</p>;
  } else if (space?.html != null) {
    body = <SpaceFrame className="space-frame bk-insight-frame" label={space.title} mode="page"
      space={{ html: space.html, title: space.title, genre: space.genre ?? 'report',
        dateLabel: letterDate(space.createdAt) }}
      {...(props.currentChapter === undefined ? {} : { bookPosition: {
        bookId: props.bookId, chapter: props.currentChapter } })}
      onBookJump={(position) => {
        if (position.bookId === props.bookId) props.onPosition(position.chapter, position.offset);
      }} />;
  } else {
    body = <p className="block-empty" role="status">正在读…</p>;
  }
  return <div className="bk-insight-content">
    {status === 'ready' ? <div className="bk-insight-tools">{props.tools}<span className="grow" />
      <IconButton icon="refresh" label={`重新生成${name}`} onClick={() => props.onGenerate(true)} /></div> : null}
    {body}
  </div>;
}

export interface OutlineTabProps extends InsightStateProps {
  toc: readonly BookTocEntry[];
  currentChapter: number;
  now: Date;
  onJump: (chapter: number, offset?: number) => void;
}

export function OutlineTab(props: OutlineTabProps): ReactNode {
  return <InsightContent {...props} onPosition={props.onJump} />;
}

export interface KeyPointsTabProps extends InsightStateProps {
  toc: readonly BookTocEntry[];
  annotations: readonly BookAnnotationView[];
  shown: boolean;
  now: Date;
  onShownChange: (shown: boolean) => void;
  onJump: (point: BookKeyPoint) => void;
  onPosition: (chapter: number, offset: number) => void;
}

export function KeyPointsTab(props: KeyPointsTabProps): ReactNode {
  return <InsightContent {...props} tools={<label className="bk-mark-toggle">
    <input type="checkbox" checked={props.shown} onChange={(event) => props.onShownChange(event.target.checked)} />
    在原文里标出</label>} />;
}
