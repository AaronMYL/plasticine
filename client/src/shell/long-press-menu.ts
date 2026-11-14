// 触屏长按一行（11-14 界面统一，Aaron「兼顾鼠标、触控板和触屏操作」）：按住标了 data-context-row 的一行半秒，出这一行
// 「⋯」（data-row-menu）的菜单，和右键、点 ⋯ 出的是同一份；按住时手指挪开超过 10 像素、抬起、滚动都算没长按。
// 长按出了菜单，这一下松手后的那次点击不再打开这一行。能打字的地方不管，交给系统（选字、粘贴）。

import { useEffect } from 'react';
import { openAt } from './popover.tsx';

/** 按住多久算长按。 */
export const LONG_PRESS_MS = 500;
/** 手指挪开多远就不算长按了（像素）。 */
const SLOP_PX = 10;

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** 按在这里，长按要出的那个 ⋯；不在可长按的一行里就是 null。 */
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
        // 打开菜单本身就是点一下 ⋯：点完再记着吞掉松手后那一下。
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
    // 长按时系统会发 contextmenu（安卓）：可长按的一行交给上面这份菜单，不再出系统那份。
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
