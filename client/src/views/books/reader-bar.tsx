import type { ReactNode } from 'react';
import type { BookProgressView } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { chapterShort, percentText } from './book-format.ts';
import { timeText } from '../../shell/time-text.ts';

export type ReaderPanel = 'toc' | 'annotations' | 'insights' | 'search' | 'type';

export interface ReaderBarProps {
  title: string;
  author: string | null;
  chapterTitle: string;
  annotationCount: number;
  phone: boolean;
  onBack: () => void;
  onOpen: (panel: ReaderPanel) => void;
}

const MAX_BADGE = 99;

export function ReaderBar(props: ReaderBarProps): ReactNode {
  const where = props.phone ? chapterShort(props.chapterTitle)
    : [props.author, props.chapterTitle.replace(/　/g, ' ')].filter((part) => part !== null).join(' · ');
  const count = props.annotationCount > MAX_BADGE ? `${MAX_BADGE}+` : String(props.annotationCount);
  return (
    <header className="bk-bar">
      <IconButton icon="back" label="回到图书馆" onClick={props.onBack} />
      <div className="bk-bar-title">
        <strong>{props.title}</strong>
        <span className="text-meta">{where}</span>
      </div>
      <IconButton icon="toc" label="目录" onClick={() => props.onOpen('toc')} />
      <IconButton icon="bookmark" label={`标注与讨论，${props.annotationCount} 条标注`}
        onClick={() => props.onOpen('annotations')}>
        {props.annotationCount > 0 ? <span className="bk-bar-count" aria-hidden="true">{count}</span> : null}
      </IconButton>
      {props.phone ? null : <IconButton icon="sparkle" label="大纲与重点" onClick={() => props.onOpen('insights')} />}
      {props.phone ? null : <IconButton icon="search" label="在书里找" onClick={() => props.onOpen('search')} />}
      <button type="button" className="bk-aa" aria-label="字号与翻页" data-tip="字号与翻页"
        onClick={() => props.onOpen('type')}>Aa</button>
    </header>
  );
}

export interface OtherDeviceBannerProps {
  progress: BookProgressView;
  chapterTitle: string;
  now: Date;
  onJump: () => void;
  onStay: () => void;
}

export function OtherDeviceBanner(props: OtherDeviceBannerProps): ReactNode {
  const { progress } = props;
  return (
    <div className="banner bk-banner" role="status">
      <span className="dot dot-run" aria-hidden="true" />
      <span className="banner-text">
        {`${progress.deviceLabel} 上读到 ${chapterShort(props.chapterTitle)} · ${percentText(progress.percent)}`}
        {`（${timeText(progress.updatedAt, props.now)}）`}
      </span>
      <button type="button" className="text-button" onClick={props.onJump}>跳过去</button>
      <button type="button" className="text-button text-button-quiet" onClick={props.onStay}>留在这里</button>
    </div>
  );
}
