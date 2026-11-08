import { useEffect, useRef, type RefObject } from 'react';

const openSheets: HTMLElement[] = [];
const FOCUSABLE = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function controls(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const style = getComputedStyle(element);
    return !element.matches(':disabled') && element.tabIndex >= 0
      && element.closest('[hidden], [inert], [aria-hidden="true"]') === null
      && style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/** 电脑面板只按层级关闭；手机模态抽屉额外约束键盘焦点，关闭后回到原入口。 */
export function useSheetFocus(open: boolean, modal: boolean,
  ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const panel = ref.current;
    if (!open || panel === null) {
      return;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openSheets.push(panel);
    panel.focus();
    const isTop = (): boolean => openSheets.at(-1) === panel;
    const onFocus = (event: FocusEvent): void => {
      if (modal && isTop() && event.target instanceof Node && !panel.contains(event.target)) {
        panel.focus();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!isTop() || event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (!modal || event.key !== 'Tab') {
        return;
      }
      const items = controls(panel);
      const first = items[0] ?? panel;
      const last = items.at(-1) ?? panel;
      const active = document.activeElement;
      if (active === panel || !panel.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      const wasTop = isTop();
      const index = openSheets.indexOf(panel);
      if (index !== -1) {
        openSheets.splice(index, 1);
      }
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (wasTop && opener?.isConnected) {
        opener.focus();
      }
    };
  }, [open, modal, ref]);
}
