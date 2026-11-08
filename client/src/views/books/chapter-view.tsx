// 一章正文：把服务端规范过的 html 放进容器（插图换成插图地址），再按下标把高亮、Plasticine 的重点虚线、
// 跳转时的闪一下套上去。容器里的子节点由这里直接管（React 不渲染它们），每次装饰变了就整章重放一遍，
// 这样高亮永远是「原文 + 当前标注」算出来的，不会越套越乱。

import { useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { HighlightColor } from '../../api/shared.ts';
import { UI_ATTRIBUTE, wrapBetween } from './text-offsets.ts';

export interface HighlightMark {
  id: string;
  start: number;
  end: number;
  color: HighlightColor;
  /** Plasticine 标的、你收下的：底色之外再加一条细线，和你自己划的分开。 */
  plasticine: boolean;
  /** 有批注时角标上的序号；没有批注是 null。 */
  noteIndex: number | null;
}

export interface KeyPointMark {
  pointId: string;
  start: number;
  end: number;
}

export interface FlashMark {
  start: number;
  end: number;
  /** 同一处再跳一次也要重放（闪一下、滚过去），每次跳转换一个数。 */
  nonce: number;
}

export interface ChapterViewProps {
  html: string;
  assetUrl: (key: string) => string;
  highlights: readonly HighlightMark[];
  keyPoints: readonly KeyPointMark[];
  /** 页边放不下批注时，在高亮后面放一个小角标，点开看批注。 */
  noteMarkers: boolean;
  flash: FlashMark | null;
  /** 正文放好、装饰套好之后调（量位置、滚动到要去的地方）。 */
  onRendered: (root: HTMLElement) => void;
  onHighlight: (annotationId: string, element: HTMLElement) => void;
  onKeyPoint: (pointId: string, element: HTMLElement) => void;
}

function element(tag: string, className: string, data: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  for (const [key, value] of Object.entries(data)) {
    node.dataset[key] = value;
  }
  return node;
}

function decorate(root: HTMLElement, props: ChapterViewProps): void {
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-asset]')) {
    image.src = props.assetUrl(image.dataset.asset ?? '');
    image.loading = 'lazy';
  }
  // 先套重点虚线，再套高亮：两者重叠时高亮在里面，点下去打开的是高亮的菜单。
  for (const point of props.keyPoints) {
    wrapBetween(root, point.start, point.end, () => element('span', 'bk-ai', { keyPoint: point.pointId }));
  }
  for (const mark of props.highlights) {
    const wrapped = wrapBetween(root, mark.start, mark.end, () => {
      const span = element('span', mark.plasticine ? 'bk-hl bk-hl-ai' : 'bk-hl', { annotationId: mark.id });
      span.dataset.c = mark.color;
      return span;
    });
    const last = wrapped.at(-1);
    if (props.noteMarkers && mark.noteIndex !== null && last !== undefined) {
      const marker = element('button', 'bk-note-mark', { noteFor: mark.id });
      marker.setAttribute(UI_ATTRIBUTE, '');
      marker.setAttribute('type', 'button');
      marker.setAttribute('aria-label', `看批注 ${mark.noteIndex}`);
      marker.textContent = String(mark.noteIndex);
      last.after(marker);
    }
  }
  if (props.flash !== null) {
    wrapBetween(root, props.flash.start, props.flash.end, () => element('span', 'bk-flash'));
  }
}

export function ChapterView(props: ChapterViewProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  // 装饰的「指纹」：内容没变就不重放，滚动、开菜单这些重渲染不会打断选区。
  const signature = useMemo(() => JSON.stringify([props.highlights, props.keyPoints, props.noteMarkers,
    props.flash]), [props.highlights, props.keyPoints, props.noteMarkers, props.flash]);
  useLayoutEffect(() => {
    const container = root.current;
    if (container === null) {
      return;
    }
    container.innerHTML = props.html;
    decorate(container, latest.current);
    latest.current.onRendered(container);
  }, [props.html, signature]);
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element) || document.getSelection()?.isCollapsed === false) {
      return;
    }
    const marker = event.target.closest<HTMLElement>('[data-note-for]');
    const highlight = marker ?? event.target.closest<HTMLElement>('[data-annotation-id]');
    const id = marker?.dataset.noteFor ?? highlight?.dataset.annotationId;
    if (highlight !== null && id !== undefined) {
      props.onHighlight(id, highlight);
      return;
    }
    const point = event.target.closest<HTMLElement>('[data-key-point]');
    if (point?.dataset.keyPoint !== undefined) {
      props.onKeyPoint(point.dataset.keyPoint, point);
    }
  };
  return <div ref={root} className="bk-content" onClick={onClick} />;
}
