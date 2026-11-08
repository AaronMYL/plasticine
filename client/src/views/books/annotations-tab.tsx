// 「标注」tab：筛选（全部 / 高亮 n / 四色 / 批注 n / 收下的重点 n）、「导出成笔记」，按章分组的列表。
// 每条左边一条高亮色的竖线（Plasticine 标的、你收下的用 1px --fg3 细线加小签），下面批注、位置、时间、设备，
// 「在对话里提」「回到原文 ›」。重新对不上原文的写「原文里没找到这一段」，不藏起来。

import { useState, type ReactNode } from 'react';
import { HIGHLIGHT_COLORS, type BookAnnotationView, type BookTocEntry,
  type HighlightColor } from '../../api/shared.ts';
import { bookPercent, percentText, readingTime } from './book-format.ts';
import { COLOR_NAMES } from './reader-popovers.tsx';

type Kind = 'all' | 'highlight' | 'note' | 'accepted';

function kindOf(annotation: BookAnnotationView): Exclude<Kind, 'all'> {
  if (annotation.origin === 'plasticine') {
    return 'accepted';
  }
  return annotation.note === null ? 'highlight' : 'note';
}

export interface AnnotationsTabProps {
  annotations: readonly BookAnnotationView[];
  toc: readonly BookTocEntry[];
  /** 在当前这一章里重新对不上原文的几条。 */
  unanchored: ReadonlySet<string>;
  now: Date;
  exporting: boolean;
  exportError: string | null;
  onExport: () => void;
  onQuote: (annotation: BookAnnotationView) => void;
  onJump: (annotation: BookAnnotationView) => void;
}

function Row({ annotation, props }: { annotation: BookAnnotationView; props: AnnotationsTabProps }): ReactNode {
  const plasticine = annotation.origin === 'plasticine';
  const lost = props.unanchored.has(annotation.id);
  return (
    <li className="bk-ann">
      <p className={plasticine ? 'bk-ann-quote is-ai' : 'bk-ann-quote is-hl'} data-c={annotation.color}>
        {annotation.quote}
      </p>
      {annotation.note === null ? null : <p className="bk-ann-note"><span>批注</span>{annotation.note}</p>}
      <div className="bk-ann-meta text-meta">
        {plasticine ? <span className="tag tag-outline-quiet">Plasticine 标的 · 已收下</span> : null}
        <span>{percentText(bookPercent(props.toc, annotation.chapter, annotation.start))}</span>
        <span>
          {[readingTime(annotation.createdAt, props.now), annotation.deviceLabel].filter(Boolean).join(' · ')}
        </span>
        {lost ? <span className="is-error">原文里没找到这一段</span> : null}
        <span className="grow" />
        <button type="button" className="text-button text-button-quiet" onClick={() => props.onQuote(annotation)}>
          在对话里提
        </button>
        <button type="button" className="text-button" disabled={lost} onClick={() => props.onJump(annotation)}>
          回到原文 ›
        </button>
      </div>
    </li>
  );
}

export function AnnotationsTab(props: AnnotationsTabProps): ReactNode {
  const [kind, setKind] = useState<Kind>('all');
  const [color, setColor] = useState<HighlightColor | null>(null);
  const count = (wanted: Exclude<Kind, 'all'>): number =>
    props.annotations.filter((annotation) => kindOf(annotation) === wanted).length;
  const shown = props.annotations.filter((annotation) => (kind === 'all' || kindOf(annotation) === kind)
    && (color === null || annotation.color === color));
  const chapters = [...new Set(shown.map((annotation) => annotation.chapter))].sort((a, b) => a - b);
  const chip = (value: Kind, label: string): ReactNode => (
    <button type="button" className="chip-button" aria-pressed={kind === value}
      onClick={() => setKind(value)}>{label}</button>
  );
  return (
    <>
      <div className="bk-filter-row">
        <div className="bk-filter" role="group" aria-label="筛选标注">
          {chip('all', '全部')}
          {chip('highlight', `高亮 ${count('highlight')}`)}
          <span className="bk-swatches" role="group" aria-label="按颜色筛">
            {HIGHLIGHT_COLORS.map((value) => (
              <button key={value} type="button" className="bk-swatch-button" aria-pressed={color === value}
                aria-label={`只看${COLOR_NAMES[value]}`} onClick={() => setColor(color === value ? null : value)}>
                <span className="bk-swatch" data-c={value} />
              </button>
            ))}
          </span>
          {chip('note', `批注 ${count('note')}`)}
          {chip('accepted', `收下的重点 ${count('accepted')}`)}
        </div>
        <span className="grow" />
        <button type="button" className="chip-button" disabled={props.exporting || props.annotations.length === 0}
          onClick={props.onExport}>{props.exporting ? '正在导出…' : '导出成笔记'}</button>
      </div>
      {props.exportError === null ? null : <p className="block-empty is-error" role="alert">{props.exportError}</p>}
      {shown.length === 0 ? (
        <p className="block-empty">{props.annotations.length === 0
          ? '还没有标注。在正文里选中一段，点一个颜色就是高亮。' : '没有符合筛选的标注。'}</p>
      ) : chapters.map((chapter) => {
        const rows = shown.filter((annotation) => annotation.chapter === chapter);
        const title = props.toc[chapter]?.title ?? `第 ${chapter + 1} 章`;
        return (
          <section key={chapter} className="bk-ann-group" aria-label={title}>
            <h3 className="bk-group-title"><span>{title}</span>
              <span>{rows.length}</span></h3>
            <ul className="bk-ann-list">{rows.map((annotation) =>
              <Row key={annotation.id} annotation={annotation} props={props} />)}</ul>
          </section>
        );
      })}
    </>
  );
}
