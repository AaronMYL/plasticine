// 阅读页顶上一条：返回图书馆、书名 + 作者 · 章名、目录 / 标注与讨论（带数）/ 大纲与重点 / 在书里找 / Aa。
// 手机上只留返回、目录、标注、Aa。别的设备读得更靠后时，下面一条细横幅：「iPhone 上读到 卷二 · 42%（今天 08:12）」。

import type { ReactNode } from 'react';
import type { BookProgressView } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { chapterShort, percentText, readingTime } from './book-format.ts';

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

// 角标最多写到 99，再多写 99+（和页头站内信的角标一样）。
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
    <div className="bk-banner" role="status">
      <span className="dot dot-run" aria-hidden="true" />
      <span className="bk-banner-text text-meta">
        {`${progress.deviceLabel} 上读到 ${chapterShort(props.chapterTitle)} · ${percentText(progress.percent)}`}
        {`（${readingTime(progress.updatedAt, props.now)}）`}
      </span>
      <button type="button" className="chip-button" onClick={props.onJump}>跳过去</button>
      <button type="button" className="text-button text-button-quiet" onClick={props.onStay}>留在这里</button>
    </div>
  );
}
