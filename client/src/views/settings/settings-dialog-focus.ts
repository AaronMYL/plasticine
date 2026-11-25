import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
const ATTACHED = '.popover, [role="tooltip"], [data-settings-layer]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.matches(':disabled')
    && element.tabIndex >= 0 && element.closest('[inert], [hidden], [aria-hidden="true"]') === null);
}

function scope(panel: HTMLElement): HTMLElement {
  return document.querySelector<HTMLElement>('[data-settings-layer] .sheet')
    ?? panel.querySelector<HTMLElement>('[role="alertdialog"]') ?? panel;
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const panel = ref.current;
    if (panel === null) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.focus({ preventScroll: true });
    const leaving = (): boolean => panel.dataset['closing'] === 'true';
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || leaving()) {
        return;
      }
      if (event.key === 'Escape') {
        if (panel.querySelector('.sheet') !== null || document.querySelector('[data-settings-layer] .sheet') !== null) {
          return;
        }
        event.preventDefault();
        escape.current();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const root = scope(panel);
      const items = focusables(root);
      const first = items[0] ?? panel;
      const last = items.at(-1) ?? panel;
      const active = document.activeElement;
      if (!root.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocus = (event: FocusEvent): void => {
      const target = event.target;
      if (leaving() || !(target instanceof Element) || panel.contains(target) || target.closest(ATTACHED) !== null) {
        return;
      }
      (focusables(scope(panel))[0] ?? panel).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      const active = document.activeElement;
      const lost = active === null || active === document.body || panel.contains(active);
      if (lost && opener?.isConnected === true) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [ref]);
}
