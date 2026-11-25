import { useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { HighlightColor } from '../../api/shared.ts';
import { UI_ATTRIBUTE, wrapBetween } from './text-offsets.ts';

export interface HighlightMark {
  id: string;
  start: number;
  end: number;
  color: HighlightColor;
  plasticine: boolean;
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
  nonce: number;
}

export interface ChapterViewProps {
  html: string;
  assetUrl: (key: string) => string;
  highlights: readonly HighlightMark[];
  keyPoints: readonly KeyPointMark[];
  noteMarkers: boolean;
  flash: FlashMark | null;
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
