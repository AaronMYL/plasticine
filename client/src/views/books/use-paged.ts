// 翻页模式的手势和排版（第 7 批第 3 条）：键盘 ← → / PageUp PageDown / 空格（Shift + 空格往回）；点阅读区左右两侧
// （各约 22% 宽，悬停时那一侧出一个圆形箭头）；触控板横向（和鼠标滚轮）一次翻一页；触摸左右滑，手指带着页走，
// 松手按距离和速度吸附到上一页 / 这一页 / 下一页。.bk-sheet 尺寸变了（窗口、对话框）重新排版回到锚点。
// 不抢的东西：输入框、对话框、菜单里的按键；带修饰键的（⌘[ ⌘] 是壳的后退前进）；鼠标侧键（壳管）；
// 屏幕左右边缘起手的触摸（iOS 的边缘返回手势）；选着字、点在高亮 / 角标 / 链接 / 按钮上的点击。

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { domSurface, sizeColumns } from './page-surface.ts';
import { Paginator } from './paginator.ts';

/** 左右两侧点了翻页的那一条占阅读区多宽（设计稿 Reader-Paged 的 zone）。 */
export const TURN_ZONE = 0.22;
/** 触控板 / 滚轮攒够这么多像素翻一页；停下这么久算一次手势结束，才能翻下一页。 */
const WHEEL_STEP = 40;
const WHEEL_QUIET_MS = 220;
/** 触摸：先动这么多才分得出是横着滑还是竖着；拖过一页宽的这么多、或者甩得够快，就翻。 */
const DRAG_SLOP = 8;
const DRAG_TURN = 0.18;
const FLICK_SPEED = 0.45;
/** 拖完松手后这么久内的 click 是拖出来的，不当点两侧。 */
const CLICK_AFTER_DRAG_MS = 350;
/** 屏幕边缘这么宽内起手的触摸留给系统（iOS 边缘返回）。 */
const EDGE_GUARD = 24;
/** 滚轮按行给（deltaMode 1）时一行折多少像素。 */
const LINE_PIXELS = 16;

const INTERACTIVE = 'a, button, input, textarea, select, label, [contenteditable="true"], [data-annotation-id], '
  + '[data-key-point], [data-note-for], .bk-pop';
const NOT_FOR_US = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], '
  + '[role="menu"], [role="listbox"], .chat-dialog';

export type TurnSide = 'prev' | 'next';

export interface PagedOptions {
  enabled: boolean;
  /** 阅读区（.bk-page）：点、滑、滚轮都在它上面。 */
  stage: HTMLElement | null;
  /** 一页宽的滚动容器（.bk-sheet）。 */
  sheet: HTMLElement | null;
  /** 多栏容器（.bk-text）。 */
  text: HTMLElement | null;
  /** 章节正文（ChapterView 的容器）。 */
  root: RefObject<HTMLElement | null>;
  /** 有弹出菜单、目录这些开着：键盘不翻。 */
  busy: () => boolean;
  /** 开始翻（收掉弹出菜单）。 */
  onTurnStart: () => void;
  onTurned: (offset: number) => void;
  onEdge: (direction: 1 | -1) => void;
}

export interface Paged {
  paginator: Paginator | null;
  /** 鼠标停在哪一侧（那一侧出箭头）。 */
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

  // 这一页的大小变了（窗口、对话框收起展开、手机转屏）：栏宽栏高跟着变，回到锚点那一页。
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
    // 触控板一次横扫会连着来几十个 wheel：攒够一步翻一页，然后锁住直到这一阵停下。也拦掉浏览器的横扫后退。
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
    // 拖着翻完松手，浏览器有时还补一个 click：拖完之后紧跟着的那一下不算点两侧。
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
