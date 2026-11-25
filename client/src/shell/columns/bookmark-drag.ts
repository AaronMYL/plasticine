import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { EASE_OUT, MOTION, play } from '../motion.ts';

const DRAG_START_PX = 4;
export const BOOKMARK_ROW_ATTRIBUTE = 'data-bookmark-id';

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
  lineTop: number;
}

export interface BookmarkDrag {
  dragging: string | null;
  drop: BookmarkDrop | null;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string) => void;
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
