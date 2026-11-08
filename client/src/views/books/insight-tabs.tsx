// 「大纲」「重点」两个 tab：都是 Plasticine 写的，顶上一行出处（「Plasticine 写的 · 时间」小签 + 说明 + 重新生成），
// 没有时一个「生成大纲 / 生成重点」主按钮，生成中写「Plasticine 正在逐章归纳…」，失败照写服务端的原因和「再试一次」。

import type { ReactNode } from 'react';
import type { BookAnnotationView, BookInsightKind, BookInsightView, BookKeyPoint,
  BookTocEntry } from '../../api/shared.ts';
import { chapterShort, readingTime } from './book-format.ts';
import { pointAccepted, pointSource, visiblePoints } from './key-points.ts';

const KIND_NAMES: Readonly<Record<BookInsightKind, string>> = { outline: '大纲', key_points: '重点' };

export interface InsightStateProps {
  kind: BookInsightKind;
  insight: BookInsightView | null;
  loadError: string | null;
  actionError: string | null;
  onGenerate: (force: boolean) => void;
}

/** 还没有内容时的三种样子；有内容（ready）返回 null，由各 tab 自己画。 */
function insightPlaceholder(props: InsightStateProps): ReactNode {
  const name = KIND_NAMES[props.kind];
  if (props.loadError !== null) {
    return <p className="block-empty is-error" role="alert">{props.loadError}</p>;
  }
  if (props.insight === null) {
    return <p className="block-empty">正在读…</p>;
  }
  const { status } = props.insight;
  if (status === 'generating') {
    return <p className="bk-generating" role="status"><span className="dot dot-run" aria-hidden="true" />
      Plasticine 正在逐章归纳…</p>;
  }
  if (status === 'failed') {
    return (
      <div className="bk-insight-empty">
        <p className="block-empty is-error" role="alert">{`${name}没生成出来：${props.insight.error ?? '原因没有记下。'}`}</p>
        <button type="button" className="primary-button" onClick={() => props.onGenerate(true)}>再试一次</button>
      </div>
    );
  }
  if (status === 'none') {
    return (
      <div className="bk-insight-empty">
        <p className="block-empty">{props.kind === 'outline' ? 'Plasticine 还没给这本书写大纲：逐章归纳，再合成一份。'
          : 'Plasticine 还没标这本书的重点：每条都会写明有没有原文依据。'}</p>
        <button type="button" className="primary-button" onClick={() => props.onGenerate(false)}>生成{name}</button>
        {props.actionError === null ? null : <p className="block-empty is-error" role="alert">{props.actionError}</p>}
      </div>
    );
  }
  return null;
}

function Provenance({ insight, now, extra, action }: {
  insight: BookInsightView;
  now: Date;
  extra: ReactNode;
  /** 右端那一样：大纲是「重新生成」，重点是「在原文里标出」。 */
  action: ReactNode;
}): ReactNode {
  return (
    <div className="bk-provenance text-meta">
      <span className="tag tag-outline-quiet">
        Plasticine 写的{insight.generatedAt === null ? '' : ` · ${readingTime(insight.generatedAt, now)}`}
      </span>
      {extra}
      {insight.stale ? <span>书换过文件，可以重新生成</span> : null}
      <span className="grow" />
      {action}
    </div>
  );
}

export interface OutlineTabProps extends InsightStateProps {
  toc: readonly BookTocEntry[];
  currentChapter: number;
  now: Date;
  onJump: (chapter: number) => void;
}

export function OutlineTab(props: OutlineTabProps): ReactNode {
  const placeholder = insightPlaceholder(props);
  const outline = props.insight?.outline;
  if (placeholder !== null || props.insight === null || outline == null) {
    return placeholder;
  }
  return (
    <>
      <Provenance insight={props.insight} now={props.now} extra={<span>{outline.note}</span>}
        action={<button type="button" className="text-button text-button-quiet"
          onClick={() => props.onGenerate(true)}>重新生成</button>} />
      {props.actionError === null ? null : <p className="block-empty is-error" role="alert">{props.actionError}</p>}
      <ol className="bk-outline">
        {outline.parts.map((part, index) => {
          const current = part.chapter === props.currentChapter;
          const volume = chapterShort(props.toc[part.chapter]?.title ?? '');
          return (
            <li key={`${part.chapter}:${index}`}>
              <button type="button" className="bk-ol-row" aria-current={current ? 'true' : undefined}
                onClick={() => props.onJump(part.chapter)}>
                <span className="bk-ol-vol text-meta">{volume === part.title ? '' : volume}
                  {current ? <><br />你在这</> : null}</span>
                <span className="bk-ol-body">
                  <span className="bk-ol-title">{part.title}</span>
                  {part.summary === '' ? null : <span className="bk-ol-summary">{part.summary}</span>}
                  {part.points.length === 0 ? null : (
                    <span className="bk-ol-points">{part.points.map((point) => (
                      <span key={point} className="bk-ol-point">{point}</span>))}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="block-empty">每一条都能点回原文；大纲只在书变了或你让 Plasticine 重写时才重做。</p>
    </>
  );
}

export interface KeyPointsTabProps extends InsightStateProps {
  toc: readonly BookTocEntry[];
  annotations: readonly BookAnnotationView[];
  shown: boolean;
  now: Date;
  onShownChange: (shown: boolean) => void;
  onJump: (point: BookKeyPoint) => void;
}

export function KeyPointsTab(props: KeyPointsTabProps): ReactNode {
  const placeholder = insightPlaceholder(props);
  if (placeholder !== null || props.insight === null) {
    return placeholder;
  }
  const points = visiblePoints(props.insight);
  const dismissed = props.insight.dismissedPointIds.length;
  return (
    <>
      <Provenance insight={props.insight} now={props.now} extra={<span>{points.length} 条</span>}
        action={<label className="bk-mark-toggle">
          <input type="checkbox" checked={props.shown}
            onChange={(event) => props.onShownChange(event.target.checked)} />
          在原文里标出
        </label>} />
      <ol className="bk-keys">
        {points.map((point, index) => (
          <li key={point.id}>
            <button type="button" className="bk-key" disabled={point.anchors.length === 0}
              onClick={() => props.onJump(point)}>
              <span className="bk-key-n">{index + 1}</span>
              <span className="bk-key-body">
                <span>{point.text}</span>
                <span className="bk-key-src text-meta">
                  {pointSource(point, props.toc)}{pointAccepted(point, props.annotations) ? ' · 已收下' : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="block-empty">标在原文里的重点是虚线，和你自己的高亮分开；点「收下」才变成你的高亮。
        {dismissed > 0 ? `另有 ${dismissed} 条你不要了。` : ''}</p>
      <button type="button" className="text-button text-button-quiet bk-regenerate"
        onClick={() => props.onGenerate(true)}>重新生成</button>
      {props.actionError === null ? null : <p className="block-empty is-error" role="alert">{props.actionError}</p>}
    </>
  );
}
