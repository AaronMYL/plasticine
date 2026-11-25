import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { TabPlace, WebTabsStore } from '../../state/web-tabs.ts';
import { EASE_OUT, MOTION, play } from '../motion.ts';

const DRAG_START_PX = 4;

export interface DropTarget {
  place: TabPlace;
  index: number;
  lineTop: number | null;
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
  dragging: string | null;
  target: DropTarget | null;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string) => void;
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
