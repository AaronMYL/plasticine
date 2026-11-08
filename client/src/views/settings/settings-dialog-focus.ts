// 设置弹框的焦点（2026-11-05）：打开时焦点进弹框，Tab 只在弹框里转，Esc 交给弹框（有没保存的
// 修改时先问），关了回到打开它的那个按钮。弹框里再开的小弹层（⋯ 菜单，挂在 body 上）和悬停提示不算跑出去；
// 弹框里再开的浮层（Sheet，比如「关注点」）开着时 Esc 先关它。

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
/** 挂在 body 上、但属于弹框里那一步的东西：⋯ 菜单这类小弹层、悬停提示。 */
const ATTACHED = '.popover, [role="tooltip"], [data-settings-layer]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.matches(':disabled')
    && element.tabIndex >= 0 && element.closest('[inert], [hidden], [aria-hidden="true"]') === null);
}

/** 这一刻键盘该在哪一块里转：问「有没保存的修改」时只在那一小块里，否则整个弹框。 */
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
    // 焦点先给弹框本身（不画焦点环）：读屏念出「设置」，Tab 从第一段开始；点开时不在分段上冒一圈黑框。
    panel.focus({ preventScroll: true });
    // 收起动画那一下（data-closing）弹框已经在走了：不再拦键盘和焦点。
    const leaving = (): boolean => panel.dataset['closing'] === 'true';
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || leaving()) {
        return;
      }
      if (event.key === 'Escape') {
        // 弹框里的浮层（Sheet）自己会关。
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
      // 焦点跟着弹框一起没了（落回 body）才送回打开它的地方；收起时已经去了别处（比如点开的菜单）就不抢回来。
      const active = document.activeElement;
      const lost = active === null || active === document.body || panel.contains(active);
      if (lost && opener?.isConnected === true) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [ref]);
}
