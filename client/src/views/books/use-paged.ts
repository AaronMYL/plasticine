import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { domSurface, sizeColumns } from './page-surface.ts';
import { Paginator } from './paginator.ts';

export const TURN_ZONE = 0.22;
const WHEEL_STEP = 40;
const WHEEL_QUIET_MS = 220;
const DRAG_SLOP = 8;
const DRAG_TURN = 0.18;
const FLICK_SPEED = 0.45;
const CLICK_AFTER_DRAG_MS = 350;
const EDGE_GUARD = 24;
const LINE_PIXELS = 16;

const INTERACTIVE = 'a, button, input, textarea, select, label, [contenteditable="true"], [data-annotation-id], '
  + '[data-key-point], [data-note-for], .bk-pop';
const NOT_FOR_US = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], '
  + '[role="menu"], [role="listbox"], .chat-dialog';

export type TurnSide = 'prev' | 'next';

export interface PagedOptions {
  enabled: boolean;
  stage: HTMLElement | null;
  sheet: HTMLElement | null;
  text: HTMLElement | null;
  root: RefObject<HTMLElement | null>;
  busy: () => boolean;
  onTurnStart: () => void;
  onTurned: (offset: number) => void;
  onEdge: (direction: 1 | -1) => void;
}

export interface Paged {
  paginator: Paginator | null;
  hover: TurnSide | null;
  turn: (direction: 1 | -1) => void;
}

function selecting(): boolean {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

function sideAt(stage: HTMLElement, clientX: number): TurnSide | null {
  const rect = stage.getBoundingClientRect();
  if (rect.width === 0) return null;
  const x = (clientX - rect.left) / rect.width;
  if (x < TURN_ZONE) return 'prev';
  return x > 1 - TURN_ZONE ? 'next' : null;
}

export function usePaged(options: PagedOptions): Paged {
  const { enabled, stage, sheet, text, root } = options;
  const latest = useRef(options);
  latest.current = options;
  const [hover, setHover] = useState<TurnSide | null>(null);
  const paginator = useMemo(() => (sheet === null || text === null ? null : new Paginator(
    domSurface(sheet, text, () => root.current),
    { onTurned: (offset) => latest.current.onTurned(offset), onEdge: (direction) => latest.current.onEdge(direction) },
  )), [sheet, text, root]);
  const turn = useMemo(() => (direction: 1 | -1): void => {
    if (paginator === null) return;
    latest.current.onTurnStart();
    void paginator.turn(direction);
  }, [paginator]);

  useEffect(() => {
    if (!enabled || sheet === null || text === null || paginator === null) return undefined;
    const relayout = (): void => {
      sizeColumns(sheet, text);
      paginator.relayout();
    };
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', relayout);
      return () => window.removeEventListener('resize', relayout);
    }
    const observer = new ResizeObserver(relayout);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [enabled, sheet, text, paginator]);

  useEffect(() => {
    if (!enabled) return undefined;
    const keys = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(NOT_FOR_US) != null || latest.current.busy()) return;
      const space = event.key === ' ';
      if (space && target?.closest('a, button') != null) return;
      let direction: 1 | -1 | null = null;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || space && !event.shiftKey) direction = 1;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp' || space && event.shiftKey) direction = -1;
      if (direction === null || (event.shiftKey && !space)) return;
      event.preventDefault();
      turn(direction);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [enabled, turn]);

  useEffect(() => {
    if (!enabled || stage === null || sheet === null) return undefined;
    let wheelTotal = 0;
    let wheelLocked = false;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return;
      event.preventDefault();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelLocked = false;
        wheelTotal = 0;
      }, WHEEL_QUIET_MS);
      if (wheelLocked) return;
      const scale = event.deltaMode === 1 ? LINE_PIXELS : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      wheelTotal += delta * scale;
      if (Math.abs(wheelTotal) >= WHEEL_STEP) {
        wheelLocked = true;
        turn(wheelTotal > 0 ? 1 : -1);
        wheelTotal = 0;
      }
    };
    let drag: { id: number; x: number; y: number; at: number; scroll: number; horizontal: boolean | null } | null
      = null;
    let draggedAt = Number.NEGATIVE_INFINITY;
    const down = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' || selecting() || paginator === null) return;
      if (event.clientX < EDGE_GUARD || event.clientX > window.innerWidth - EDGE_GUARD) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp,
        scroll: sheet.scrollLeft, horizontal: null };
    };
    const move = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse') {
        const side = event.target instanceof Element && event.target.closest(INTERACTIVE) !== null ? null
          : sideAt(stage, event.clientX);
        setHover((current) => (current === side ? current : side));
      }
      if (drag === null || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.horizontal === null) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        drag.horizontal = Math.abs(dx) > Math.abs(dy);
        if (drag.horizontal) {
          latest.current.onTurnStart();
          stage.setPointerCapture?.(event.pointerId);
        }
      }
      if (drag.horizontal) {
        sheet.scrollLeft = drag.scroll - dx;
      }
    };
    const up = (event: PointerEvent): void => {
      if (drag === null || event.pointerId !== drag.id || paginator === null) return;
      const { horizontal, x, at } = drag;
      drag = null;
      if (horizontal !== true) return;
      draggedAt = event.timeStamp;
      const dx = event.clientX - x;
      const speed = Math.abs(dx) / Math.max(1, event.timeStamp - at);
      const far = Math.abs(dx) > sheet.clientWidth * DRAG_TURN || speed > FLICK_SPEED;
      const direction = dx < 0 ? 1 : -1;
      const target = paginator.page + direction;
      if (!far) {
        void paginator.settle(paginator.page);
      } else if (target < 0 || target >= paginator.pages) {
        void paginator.settle(paginator.page);
        turn(direction);
      } else {
        void paginator.settle(target);
      }
    };
    const cancel = (event: PointerEvent): void => {
      if (drag !== null && event.pointerId === drag.id && paginator !== null) {
        drag = null;
        void paginator.settle(paginator.page);
      }
    };
    const click = (event: MouseEvent): void => {
      if (event.timeStamp - draggedAt < CLICK_AFTER_DRAG_MS) return;
      if (event.defaultPrevented || event.button !== 0 || selecting()) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE) !== null) return;
      const side = sideAt(stage, event.clientX);
      if (side !== null) turn(side === 'next' ? 1 : -1);
    };
    const leave = (): void => setHover(null);
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', cancel);
    stage.addEventListener('pointerleave', leave);
    stage.addEventListener('click', click);
    return () => {
      clearTimeout(wheelTimer);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', cancel);
      stage.removeEventListener('pointerleave', leave);
      stage.removeEventListener('click', click);
      setHover(null);
    };
  }, [enabled, stage, sheet, paginator, turn]);

  return { paginator, hover, turn };
}
