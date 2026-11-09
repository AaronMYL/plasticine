// 书签拖动排序（第 8 批第 1 条）：和竖排标签一样的手感（web-tab-drag.ts）——按住一行挪过 4px 算开始拖，这一行跟着手
// 上下走，一道细线标出会落在哪；松手落到最近的缝里，别的行由 FlipList 平移补位，拖着的那一行从松手处滑进新位置。
// 只在书签这一节里排，不拖进标签（书签和标签分开）。按 Esc 取消。减少动态效果时照样能拖，只是不滑。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { EASE_OUT, MOTION, play } from '../motion.ts';

/** 挪过这么多像素才算拖（不然是点击）。 */
const DRAG_START_PX = 4;
export const BOOKMARK_ROW_ATTRIBUTE = 'data-bookmark-id';

/** 指针在 y 时落进第几道缝：别的行里中线在 y 上面的有几行（拖着的那一行不算）。 */
export function dropIndex(rows: readonly { top: number; bottom: number }[], y: number): number {
  return rows.filter((row) => (row.top + row.bottom) / 2 < y).length;
}

interface Pending {
  id: string;
  row: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
}

export interface BookmarkDrop {
  index: number;
  /** 细线画在哪（相对列表顶部）。 */
  lineTop: number;
}

export interface BookmarkDrag {
  dragging: string | null;
  drop: BookmarkDrop | null;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string) => void;
  /** 刚拖完：吞掉松手后紧跟的那一下点击。 */
  swallowClick: () => boolean;
}

function rowsOf(list: HTMLElement, dragged: string): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`[${BOOKMARK_ROW_ATTRIBUTE}]`)]
    .filter((row) => row.getAttribute(BOOKMARK_ROW_ATTRIBUTE) !== dragged);
}

function dropAt(list: HTMLElement, dragged: string, y: number): BookmarkDrop {
  const rows = rowsOf(list, dragged).map((row) => row.getBoundingClientRect());
  const index = dropIndex(rows, y);
  const top = list.getBoundingClientRect().top;
  const edge = rows.length === 0 ? top : index < rows.length ? rows[index]!.top : rows[rows.length - 1]!.bottom;
  return { index, lineTop: edge - top };
}

/** list 是书签那一列；onDrop(id, index)：这一个放到别的书签里的第 index 个。 */
export function useBookmarkDrag(list: RefObject<HTMLElement | null>, onDrop: (id: string, index: number) => void):
  BookmarkDrag {
  const pending = useRef<Pending | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<BookmarkDrop | null>(null);
  const dropRef = useRef<BookmarkDrop | null>(null);
  const justDropped = useRef(false);
  const landing = useRef<{ id: string; rect: DOMRect } | null>(null);
  const dropped = useRef(onDrop);
  dropped.current = onDrop;

  const reset = useCallback((): void => {
    const current = pending.current;
    if (current !== null) {
      current.row.style.transform = '';
      current.row.style.zIndex = '';
    }
    pending.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
  }, []);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      const current = pending.current;
      const element = list.current;
      if (current === null || element === null) return;
      const dy = event.clientY - current.startY;
      if (!current.dragging) {
        if (Math.hypot(event.clientX - current.startX, dy) < DRAG_START_PX) return;
        current.dragging = true;
        setDragging(current.id);
      }
      current.row.style.transform = `translate(0, ${dy}px)`;
      current.row.style.zIndex = '2';
      const next = dropAt(element, current.id, event.clientY);
      dropRef.current = next;
      setDrop(next);
    };
    const up = (): void => {
      const current = pending.current;
      if (current === null) return;
      const target = dropRef.current;
      if (current.dragging) {
        justDropped.current = true;
        window.setTimeout(() => {
          justDropped.current = false;
        }, 0);
        if (target !== null) {
          landing.current = { id: current.id, rect: current.row.getBoundingClientRect() };
          current.row.style.transform = '';
          dropped.current(current.id, target.index);
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
  }, [list, reset]);

  // 落下之后：拖着的那一行从松手的位置滑到新位置（在 FlipList 的补位之后播）。
  useLayoutEffect(() => {
    const land = landing.current;
    const element = list.current;
    if (land === null || element === null) return;
    landing.current = null;
    const row = [...element.querySelectorAll<HTMLElement>(`[${BOOKMARK_ROW_ATTRIBUTE}]`)]
      .find((candidate) => candidate.getAttribute(BOOKMARK_ROW_ATTRIBUTE) === land.id);
    if (row === undefined) return;
    const now = row.getBoundingClientRect();
    play(row, [{ transform: `translate(${land.rect.left - now.left}px, ${land.rect.top - now.top}px)` },
      { transform: 'translate(0, 0)' }], MOTION.base, EASE_OUT);
  });

  return {
    dragging,
    drop,
    onPointerDown: (event, id) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('input'))) {
        return;
      }
      pending.current = { id, row: event.currentTarget, startX: event.clientX, startY: event.clientY,
        dragging: false };
    },
    swallowClick: () => justDropped.current,
  };
}
