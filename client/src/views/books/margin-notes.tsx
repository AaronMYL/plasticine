// 页边：电脑上对话栏收起、主区够宽时，批注和 Plasticine 标的重点排在正文右边，对齐它们在正文里那一行。
// 位置在正文画好之后量（ChapterView 每次重放都会让 layoutKey 变），挨得太近的往下错开，不叠在一起。

import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface MarginItem {
  key: string;
  kind: 'note' | 'point';
  /** 正文里对应那一处的选择器（高亮或重点虚线的第一段）。 */
  selector: string;
  title: string;
  text: string;
  onAccept?: () => void;
  onDismiss?: () => void;
  onOpen?: () => void;
}

/** 页边那几条：有批注的高亮（「批注」）和 Plasticine 标的重点（同一条重点只列一次，带「收下 / 不要」）。 */
export function marginItemsOf<P extends { pointId: string; text: string }>(input: {
  highlights: readonly { id: string }[];
  keyPoints: readonly P[];
  annotations: readonly { id: string; note: string | null }[];
  onAccept: (point: P) => void;
  onDismiss: (point: P) => void;
}): MarginItem[] {
  const notes = input.highlights.flatMap((mark) => {
    const note = input.annotations.find((item) => item.id === mark.id)?.note;
    return note == null ? [] : [{ key: `n:${mark.id}`, kind: 'note' as const, title: '批注', text: note,
      selector: `[data-annotation-id="${mark.id}"]` }];
  });
  const seen = new Set<string>();
  const points = input.keyPoints.flatMap((point) => {
    if (seen.has(point.pointId)) {
      return [];
    }
    seen.add(point.pointId);
    return [{ key: `p:${point.pointId}`, kind: 'point' as const, title: 'Plasticine 标的重点', text: point.text,
      selector: `[data-key-point="${point.pointId}"]`, onAccept: () => input.onAccept(point),
      onDismiss: () => input.onDismiss(point) }];
  });
  return [...notes, ...points];
}

// 两条之间至少隔 16（间距令牌，板块内）。
const STACK_GAP = 16;

export function MarginNotes({ items, root, layoutKey }: {
  items: readonly MarginItem[];
  root: HTMLElement | null;
  layoutKey: number;
}): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = list.current?.offsetParent;
    if (root === null || list.current === null || !(container instanceof HTMLElement)) {
      return;
    }
    const base = container.getBoundingClientRect().top;
    const placed = [...list.current.querySelectorAll<HTMLElement>('[data-margin-for]')].flatMap((node) => {
      const anchor = root.querySelector<HTMLElement>(node.dataset.marginFor ?? '');
      node.hidden = anchor === null;
      return anchor === null ? [] : [{ node, top: anchor.getBoundingClientRect().top - base }];
    }).sort((a, b) => a.top - b.top);
    // 按正文里的先后从上往下排，和上一条挨太近就往下错开。
    let floor = Number.NEGATIVE_INFINITY;
    for (const { node, top: wanted } of placed) {
      const top = Math.max(wanted, floor + STACK_GAP);
      node.style.top = `${top}px`;
      floor = top + node.offsetHeight;
    }
  }, [items, root, layoutKey]);
  return (
    <div ref={list} className="bk-margins" aria-label="页边批注与重点">
      {items.map((item) => (
        <aside key={item.key} className={item.kind === 'note' ? 'bk-margin bk-margin-note' : 'bk-margin'}
          data-margin-for={item.selector}>
          <b>{item.title}</b>
          {item.onOpen === undefined ? <span>{item.text}</span>
            : <button type="button" className="bk-margin-text" onClick={item.onOpen}>{item.text}</button>}
          {item.onAccept === undefined ? null : (
            <span className="bk-margin-actions">
              <button type="button" className="text-button" onClick={item.onAccept}>收下</button>
              <button type="button" className="text-button text-button-quiet" onClick={item.onDismiss}>不要</button>
            </span>
          )}
        </aside>
      ))}
    </div>
  );
}
