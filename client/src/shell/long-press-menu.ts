import { useEffect } from 'react';
import { openAt } from './popover.tsx';

export const LONG_PRESS_MS = 500;
const SLOP_PX = 10;

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function rowMenuAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest(EDITABLE) !== null) return null;
  if (target.closest('[data-row-menu]') !== null) return null;
  return target.closest('[data-context-row]')?.querySelector<HTMLElement>('[data-row-menu]') ?? null;
}

export function useLongPressMenu(): void {
  useEffect(() => {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let swallowClick = false;
    const cancel = (): void => {
      window.clearTimeout(timer);
      start = null;
    };
    const down = (event: PointerEvent): void => {
      swallowClick = false;
      if (event.pointerType !== 'touch') return;
      const menu = rowMenuAt(event.target);
      cancel();
      if (menu === null) return;
      start = { x: event.clientX, y: event.clientY };
      const { clientX, clientY } = event;
      timer = window.setTimeout(() => {
        start = null;
        navigator.vibrate?.(10);
        openAt(menu, clientX, clientY);
        swallowClick = true;
      }, LONG_PRESS_MS);
    };
    const move = (event: PointerEvent): void => {
      if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel();
    };
    const click = (event: MouseEvent): void => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const menu = (event: MouseEvent): void => {
      if (event.defaultPrevented || rowMenuAt(event.target) === null) return;
      if (window.matchMedia?.('(pointer: coarse)').matches === true) event.preventDefault();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', cancel, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      cancel();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', cancel, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }, []);
}
