// 竖排标签拖动排序（11-07：拖动排序有动效）：按住一行挪过 4px 算开始拖，这一行跟着手走，松手落到最近的缝里——
// 同一列表里换位置、拖进另一组（或组标题上：放到组尾）、拖到置顶那一排上（置顶）。一道细线标出会落在哪。
// 落下之后别的行由 FlipList 平移补位，拖着的那一行从松手的位置滑进新位置（landing）。按 Esc 取消。
// 减少动态效果时照样能拖，只是不滑。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { TabPlace, WebTabsStore } from '../../state/web-tabs.ts';
import { EASE_OUT, MOTION, play } from '../motion.ts';

/** 挪过这么多像素才算拖（不然是点击）。 */
const DRAG_START_PX = 4;

export interface DropTarget {
  place: TabPlace;
  index: number;
  /** 指示线画在哪（相对根元素顶部）；拖到置顶那一排、组标题上时是 null（整块高亮）。 */
  lineTop: number | null;
  /** 高亮的那一块：'pins' 或组 id。 */
  zone: string | null;
}

interface Pending {
  id: string;
  row: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
}

function placeOfList(element: Element): TabPlace | null {
  const list = element.getAttribute('data-drop-list');
  if (list === 'today') return { list: 'today' };
  if (list === 'pinned') return { list: 'pinned' };
  if (list !== null && list.startsWith('group:')) return { list: 'group', groupId: list.slice('group:'.length) };
  return null;
}

/** 指针下面会落在哪：先看置顶那一排和组标题，再找最近的一道缝。 */
function targetAt(root: HTMLElement, y: number, x: number, dragged: string): DropTarget | null {
  const top = root.getBoundingClientRect().top;
  const pins = root.querySelector<HTMLElement>('[data-drop-pins]');
  if (pins !== null) {
    const rect = pins.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom && x >= rect.left && x <= rect.right) {
      return { place: { list: 'pinned' }, index: Number.MAX_SAFE_INTEGER, lineTop: null, zone: 'pins' };
    }
  }
  for (const head of root.querySelectorAll<HTMLElement>('[data-group-head]')) {
    const rect = head.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) {
      const groupId = head.getAttribute('data-group-head') ?? '';
      return { place: { list: 'group', groupId }, index: Number.MAX_SAFE_INTEGER, lineTop: null, zone: groupId };
    }
  }
  let best: DropTarget | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const list of root.querySelectorAll<HTMLElement>('[data-drop-list]')) {
    const place = placeOfList(list);
    if (place === null || list.closest('[hidden]') !== null) continue;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-tab-id]')]
      .filter((row) => row.getAttribute('data-tab-id') !== dragged);
    const listRect = list.getBoundingClientRect();
    const edges = rows.length === 0 ? [listRect.top]
      : [rows[0]!.getBoundingClientRect().top, ...rows.map((row) => row.getBoundingClientRect().bottom)];
    edges.forEach((edge, index) => {
      const gap = Math.abs(edge - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = { place, index, lineTop: edge - top, zone: null };
      }
    });
  }
  return best;
}

export interface TabDrag {
  /** 正在拖的那一个标签。 */
  dragging: string | null;
  target: DropTarget | null;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string) => void;
  /** 刚拖完：吞掉松手后紧跟的那一下点击。 */
  swallowClick: () => boolean;
}

export function useTabDrag(root: RefObject<HTMLElement | null>, tabs: WebTabsStore): TabDrag {
  const pending = useRef<Pending | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const justDropped = useRef(false);
  const landing = useRef<{ id: string; rect: DOMRect } | null>(null);

  const reset = useCallback((): void => {
    const current = pending.current;
    if (current !== null) {
      current.row.style.transform = '';
      current.row.style.zIndex = '';
    }
    pending.current = null;
    targetRef.current = null;
    setDragging(null);
    setTarget(null);
  }, []);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      const current = pending.current;
      const element = root.current;
      if (current === null || element === null) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (!current.dragging) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        current.dragging = true;
        setDragging(current.id);
      }
      current.row.style.transform = `translate(0, ${dy}px)`;
      current.row.style.zIndex = '2';
      const next = targetAt(element, event.clientY, event.clientX, current.id);
      targetRef.current = next;
      setTarget(next);
    };
    const up = (): void => {
      const current = pending.current;
      if (current === null) return;
      const drop = targetRef.current;
      if (current.dragging) {
        justDropped.current = true;
        window.setTimeout(() => {
          justDropped.current = false;
        }, 0);
        if (drop !== null) {
          landing.current = { id: current.id, rect: current.row.getBoundingClientRect() };
          current.row.style.transform = '';
          tabs.move(current.id, drop.place, drop.index);
        }
      }
      reset();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && pending.current?.dragging === true) reset();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('keydown', key);
    };
  }, [root, tabs, reset]);

  // 落下之后：拖着的那一行从松手的位置滑到新位置（在 FlipList 的补位之后播，盖过它对这一行的那一段）。
  useLayoutEffect(() => {
    const land = landing.current;
    const element = root.current;
    if (land === null || element === null) return;
    landing.current = null;
    const row = [...element.querySelectorAll<HTMLElement>('[data-tab-id]')]
      .find((candidate) => candidate.getAttribute('data-tab-id') === land.id);
    if (row === undefined) return;
    const now = row.getBoundingClientRect();
    play(row, [{ transform: `translate(${land.rect.left - now.left}px, ${land.rect.top - now.top}px)` },
      { transform: 'translate(0, 0)' }], MOTION.base, EASE_OUT);
  });

  return {
    dragging,
    target,
    onPointerDown: (event, id) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('[data-no-drag-tab]'))) {
        return;
      }
      pending.current = { id, row: event.currentTarget, startX: event.clientX, startY: event.clientY,
        dragging: false };
    },
    swallowClick: () => justDropped.current,
  };
}
