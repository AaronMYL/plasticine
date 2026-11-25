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
const GAP = 6;
const EDGE = 8;
const OPEN_MS = MOTION.fast;
const CLOSE_MS = Math.round((MOTION.fast * 2) / 3);
const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

function tipText(host: Element): string {
  return host.getAttribute('data-tip')?.trim() ?? '';
}

function hostOf(target: EventTarget | null): Element | null {
  const host = target instanceof Element ? target.closest(TIP_SELECTOR) : null;
  return host !== null && tipText(host) !== '' ? host : null;
}

function isTapHost(host: Element): boolean {
  return host.hasAttribute('data-tip-tap');
}

function sideOf(host: Element): Side {
  const wanted = host.closest('[data-tip-side]')?.getAttribute('data-tip-side');
  return SIDES.find((side) => side === wanted) ?? 'top';
}

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

  useEffect(() => {
    if (!open || shown === null) {
      return undefined;
    }
    const host = shown.host;
    host.setAttribute('data-tip-open', '');
    return () => host.removeAttribute('data-tip-open');
  }, [open, shown]);

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
  content: string;
  side?: Side;
  children: ReactElement<Record<string, unknown>>;
}

export function Tooltip({ content, side, children }: TooltipProps): ReactNode {
  return cloneElement(children, { 'data-tip': content, 'data-tip-side': side });
}
