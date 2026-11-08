// 悬停提示（2026-11-04 重做，取代第 2 批跟着鼠标走的 follow-tip）。用户定：锚在触发元素上（不跟鼠标）；悬停约 500ms
// 才出、移开立即收，相邻之间瞬切；键盘 :focus-visible 出；触屏点 ⓘ 出、点别处收；自动翻边 / 贴边；可访问；
// 120–160ms 从所在一侧淡入 + 位移，收起更快，减少动态效果时只淡入淡出。只放在 ⓘ 和图标按钮这类小元素上，不放整行。
//
// 写法：给小元素加 data-tip="说明"（可选 data-tip-side="bottom"），或用 <Tooltip content>、<InfoTip text>
// （info-tip.tsx）、IconButton（名字自动进提示）。全应用只有一个 TooltipLayer（壳里挂一次），委托到最近的
// [data-tip]：这样各页只写一个属性，不必每处包一层组件，并行的分支也照这个写法合进来。
//
// 依赖 @floating-ui/react（用户 11-04 同意引入）：定位（offset + flip + shift + hide）、跟着滚动和尺寸重算
// （autoUpdate）、出入场状态（useTransitionStatus）都用它的，参考它的官方 Tooltip 示例和 Radix Tooltip。
// 出 / 收的时序在 tooltip-control.ts：委托写法拿不到每个宿主的 React 事件，不能直接用 useHover / useFocus /
// FloatingDelayGroup，时序照它们（和 Radix）的默认语义写成一个小状态机。

import {
  autoUpdate, flip, hide, offset, shift, useFloating, useTransitionStatus, type ReferenceType, type Side,
} from '@floating-ui/react';
import {
  cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MOTION } from './motion.ts';
import { TipControl } from './tooltip-control.ts';
import './tooltip.css';

export { TIP_DELAY, TIP_SKIP_WINDOW } from './tooltip-control.ts';

export const TIP_SELECTOR = '[data-tip]';
/** 浮框离元素 6px，离窗口边至少 8px（间距档）。 */
const GAP = 6;
const EDGE = 8;
/** 出 120ms（--motion-fast），收更快：三分之二。 */
const OPEN_MS = MOTION.fast;
const CLOSE_MS = Math.round((MOTION.fast * 2) / 3);
const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

function tipText(host: Element): string {
  return host.getAttribute('data-tip')?.trim() ?? '';
}

/** 事件落在哪个宿主上：最近的 [data-tip]，说明为空的不算。 */
function hostOf(target: EventTarget | null): Element | null {
  const host = target instanceof Element ? target.closest(TIP_SELECTOR) : null;
  return host !== null && tipText(host) !== '' ? host : null;
}

/** 「点了看说明」的宿主（ⓘ）：触屏点它出提示；别的宿主点了是做事，不出。 */
function isTapHost(host: Element): boolean {
  return host.hasAttribute('data-tip-tap');
}

/** 哪一侧：宿主自己或它所在的一片（工具条写一次 data-tip-side="bottom"）说了算，默认在上面。 */
function sideOf(host: Element): Side {
  const wanted = host.closest('[data-tip-side]')?.getAttribute('data-tip-side');
  return SIDES.find((side) => side === wanted) ?? 'top';
}

/** 说明已经在读屏名字（或常挂的描述）里时不再用 aria-describedby 指一遍，免得念两遍。 */
function describes(host: Element, text: string): boolean {
  const name = host.getAttribute('aria-label') ?? '';
  return !name.includes(text) && text !== host.getAttribute('aria-description')?.trim();
}

interface Shown {
  host: Element;
  text: string;
  side: Side;
}

type PointerKind = 'touch' | 'mouse' | 'keyboard';

function pointerKind(type: string): PointerKind {
  return type === 'touch' ? 'touch' : 'mouse';
}

export function TooltipLayer(): ReactNode {
  const id = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const control = useRef<TipControl<Element> | null>(null);
  if (control.current === null) {
    control.current = new TipControl<Element>((host) => {
      setShown({ host, text: tipText(host), side: sideOf(host) });
      setOpen(true);
    }, () => setOpen(false));
  }
  const tips = control.current;

  // 宿主从页面上拿掉了（换页、行删掉）：收起，不在左上角留一个孤零零的框。
  const follow = useCallback((reference: ReferenceType, floating: HTMLElement,
    update: () => void) => autoUpdate(reference, floating, () => {
    if (reference instanceof Element && !reference.isConnected) {
      tips.dismiss();
      return;
    }
    update();
  }), [tips]);
  const { refs, floatingStyles, context, placement, isPositioned, middlewareData } = useFloating({
    open,
    placement: shown?.side ?? 'top',
    strategy: 'fixed',
    transform: false,
    elements: { reference: shown?.host ?? null },
    middleware: [offset(GAP), flip({ padding: EDGE }), shift({ padding: EDGE }), hide()],
    whileElementsMounted: follow,
  });
  const { isMounted, status } = useTransitionStatus(context, { duration: { open: OPEN_MS, close: CLOSE_MS } });

  useEffect(() => {
    let last: PointerKind = 'mouse';
    const over = (event: PointerEvent): void => {
      const host = event.pointerType === 'touch' ? null : hostOf(event.target);
      if (host !== null) {
        tips.hover(host);
      }
    };
    const out = (event: PointerEvent): void => {
      const host = event.pointerType === 'touch' ? null : hostOf(event.target);
      const to = event.relatedTarget;
      if (host !== null && !(to instanceof Node && host.contains(to))) {
        tips.leave(host);
      }
    };
    const down = (event: PointerEvent): void => {
      last = pointerKind(event.pointerType);
      const host = hostOf(event.target);
      if (host !== null && isTapHost(host)) {
        return;
      }
      if (host !== null && last === 'mouse') {
        tips.press(host);
        return;
      }
      tips.dismiss();
    };
    const click = (event: MouseEvent): void => {
      const host = hostOf(event.target);
      if (host !== null && isTapHost(host)) {
        tips.tap(host, event.detail === 0 ? 'keyboard' : last);
      }
    };
    const focusIn = (event: FocusEvent): void => {
      const host = hostOf(event.target);
      if (host !== null && event.target instanceof Element && event.target.matches(':focus-visible')) {
        tips.focus(host);
      }
    };
    const focusOut = (event: FocusEvent): void => {
      const host = hostOf(event.target);
      if (host !== null) {
        tips.blur(host);
      }
    };
    const key = (event: KeyboardEvent): void => {
      last = 'keyboard';
      if (event.key === 'Escape') {
        tips.dismiss();
      }
    };
    const dismiss = (): void => tips.dismiss();
    document.addEventListener('pointerover', over, { passive: true });
    document.addEventListener('pointerout', out, { passive: true });
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      tips.dismiss();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [tips]);

  // 开着的宿主标 data-tip-open：ⓘ 开着时保持 --fg。
  useEffect(() => {
    if (!open || shown === null) {
      return undefined;
    }
    const host = shown.host;
    host.setAttribute('data-tip-open', '');
    return () => host.removeAttribute('data-tip-open');
  }, [open, shown]);

  // 开着时把说明挂到宿主的 aria-describedby 上（Radix 也是只在开着时挂），收起时还原。
  useEffect(() => {
    if (!open || shown === null || !describes(shown.host, shown.text)) {
      return undefined;
    }
    const host = shown.host;
    const previous = host.getAttribute('aria-describedby');
    host.setAttribute('aria-describedby', previous === null ? id : `${previous} ${id}`);
    return () => {
      if (previous === null) {
        host.removeAttribute('aria-describedby');
      } else {
        host.setAttribute('aria-describedby', previous);
      }
    };
  }, [open, shown, id]);

  if (!isMounted || shown === null) {
    return null;
  }
  const side = placement.split('-')[0] ?? 'top';
  const hidden = !isPositioned || middlewareData.hide?.referenceHidden === true;
  return createPortal(
    <div ref={refs.setFloating} id={id} role="tooltip" className="tooltip" data-side={side} data-status={status}
      style={hidden ? { ...floatingStyles, visibility: 'hidden' } : floatingStyles}>
      {shown.text}
    </div>,
    document.body,
  );
}

export interface TooltipProps {
  /** 提示里写的字。 */
  content: string;
  /** 默认在上面；放不下 Floating UI 会翻过去。 */
  side?: Side;
  /** 一个小元素（图标按钮、ⓘ、数值）；不要包整行。 */
  children: ReactElement<Record<string, unknown>>;
}

/** 给一个小元素加提示：等同于在它上面写 data-tip。 */
export function Tooltip({ content, side, children }: TooltipProps): ReactNode {
  return cloneElement(children, { 'data-tip': content, 'data-tip-side': side });
}
