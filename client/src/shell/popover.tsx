import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { HIT_REGION_ATTRIBUTE } from './hit-regions.ts';
import { Icon, type IconName } from './icons.tsx';
import { EASE_SPRING, MOTION, play, playThen } from './motion.ts';
import { useDismiss, type DismissReason } from './use-dismiss.ts';
import './popover.css';

const EDGE = 8;
const GAP = 4;

export interface PopoverAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let pointed: { element: Element; anchor: PopoverAnchor } | null = null;

export function openAt(button: HTMLElement, x: number, y: number): void {
  pointed = { element: button, anchor: pointAnchor(x, y) };
  try {
    button.click();
  } finally {
    pointed = null;
  }
}

export function anchorOf(element: Element): PopoverAnchor {
  if (pointed !== null && pointed.element === element) return pointed.anchor;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

export function pointAnchor(x: number, y: number): PopoverAnchor {
  return { left: x, top: y, right: x, bottom: y };
}

export interface PopoverProps {
  anchor: PopoverAnchor;
  label: string;
  role: 'menu' | 'dialog';
  align?: 'start' | 'end';
  className?: string;
  trigger?: RefObject<HTMLElement | null>;
  initialFocus?: 'first' | 'panel';
  leaving?: boolean;
  onLeft?: () => void;
  onClose: (reason: DismissReason) => void;
  children: ReactNode;
}

const FOCUSABLE = 'input, select, textarea, button:not(:disabled), [tabindex]:not([tabindex="-1"])';
const MENU_ITEMS = '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])';
function enterFrames(below: boolean): Keyframe[] {
  return [{ opacity: 0, transform: `translateY(${below ? -4 : 4}px) scale(0.96)` }, { opacity: 1, transform: 'none' }];
}
const LEAVE: Keyframe[] = [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-2px)' }];

function moveInMenu(panel: HTMLElement, key: string): boolean {
  const items = [...panel.querySelectorAll<HTMLElement>(MENU_ITEMS)];
  if (items.length === 0) {
    return false;
  }
  const index = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  const target: Partial<Record<string, number>> = {
    Home: 0,
    End: last,
    ArrowDown: index < 0 || index === last ? 0 : index + 1,
    ArrowUp: index <= 0 ? last : index - 1,
  };
  const next = target[key];
  if (next === undefined) {
    return false;
  }
  items[next]?.focus();
  return true;
}

function placeOf(element: HTMLElement, anchor: PopoverAnchor, align: PopoverProps['align']):
  { left: number; top: number } {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const preferred = align === 'end' ? anchor.right - width : anchor.left;
  const left = Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, preferred));
  const below = anchor.bottom + GAP;
  const top = below + height > window.innerHeight - EDGE ? Math.max(EDGE, anchor.top - GAP - height) : below;
  return { left, top };
}

export function Popover(props: PopoverProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const [moved, setMoved] = useState<{ from: PopoverAnchor; to: PopoverAnchor } | null>(null);
  const anchor = moved !== null && moved.from === props.anchor ? moved.to : props.anchor;
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const shown = useRef(false);
  const leaving = props.leaving === true;
  const leavingNow = useRef(leaving);
  leavingNow.current = leaving;
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const left = useRef(props.onLeft);
  left.current = props.onLeft;
  const dismissedBy = useRef<DismissReason | null>(null);
  const back = (): Element | null => {
    const reason = dismissedBy.current;
    return reason !== null && reason !== 'escape' ? null : props.trigger?.current ?? opener.current;
  };
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) {
      return;
    }
    const next = placeOf(element, anchor, props.align);
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.visibility = 'visible';
    setPlace(next);
    if (!shown.current) {
      shown.current = true;
      const below = next.top >= anchor.bottom;
      element.style.transformOrigin = `${props.align === 'end' ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;
      play(element, enterFrames(below), MOTION.base, EASE_SPRING);
    }
  }, [anchor, props.align]);
  useDismiss({
    open: !leaving,
    inside: props.trigger === undefined ? [panel] : [panel, props.trigger],
    anchor: props.trigger,
    onAnchorMove: () => {
      const trigger = props.trigger?.current;
      if (trigger !== null && trigger !== undefined) {
        setMoved({ from: props.anchor, to: anchorOf(trigger) });
      }
    },
    onDismiss: (reason) => {
      dismissedBy.current = reason;
      close.current(reason);
    },
  });
  useEffect(() => {
    const element = panel.current;
    if (element === null) {
      return;
    }
    const first = element.querySelector<HTMLElement>(props.role === 'menu' ? MENU_ITEMS : FOCUSABLE);
    if (props.initialFocus === 'panel' || first === null) {
      element.focus({ preventScroll: true });
    } else {
      first.focus({ preventScroll: true });
    }
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body;
      const target = back();
      if (lost && target instanceof HTMLElement && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    };
  }, []);
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const element = panel.current;
    const target = back();
    if (element?.contains(document.activeElement) === true && target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
    }
    playThen(element, LEAVE, MOTION.fast, () => {
      if (leavingNow.current) {
        left.current?.();
      }
    });
  }, [leaving]);
  const style = place === null
    ? { left: anchor.left, top: anchor.bottom + GAP, visibility: 'hidden' as const }
    : { left: place.left, top: place.top, visibility: 'visible' as const };
  return createPortal(
    <div ref={panel} className={`popover${props.className === undefined ? '' : ` ${props.className}`}`}
      role={props.role} aria-label={props.label} style={style} tabIndex={-1}
      data-leaving={leaving ? 'true' : undefined} {...{ [HIT_REGION_ATTRIBUTE]: 'popover' }}
      onKeyDown={(event) => {
        if (props.role !== 'menu' || panel.current === null) {
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          dismissedBy.current = 'escape';
          close.current('escape');
        } else if (moveInMenu(panel.current, event.key)) {
          event.preventDefault();
        }
      }}>
      {props.children}
    </div>,
    document.body,
  );
}

export interface MenuItemProps {
  icon?: IconName | undefined;
  label: string;
  onSelect: () => void;
  more?: boolean;
  disabled?: boolean | undefined;
  shortcut?: string | undefined;
  checked?: boolean | undefined;
  unavailable?: string;
  danger?: boolean | undefined;
}

export function MenuItem(props: MenuItemProps): ReactNode {
  const unavailable = props.unavailable !== undefined;
  return (
    <button type="button" role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className={props.danger === true ? 'popover-item is-danger' : 'popover-item'} disabled={props.disabled}
      aria-checked={props.checked} aria-disabled={unavailable ? true : undefined}
      aria-description={props.unavailable}
      onClick={unavailable ? undefined : props.onSelect}>
      {props.icon === undefined ? null : <Icon name={props.icon} size={16} />}
      {unavailable ? (
        <span className="popover-item-text">
          <span className="popover-item-label">{props.label}</span>
          <span className="popover-item-note" aria-hidden="true">{props.unavailable}</span>
        </span>
      ) : <span className="popover-item-label">{props.label}</span>}
      {props.shortcut === undefined ? null : <kbd className="popover-item-key">{props.shortcut}</kbd>}
      {props.checked === true ? <Icon name="check" size={14} /> : null}
      {props.more === true ? <Icon name="chevron-right" size={14} /> : null}
    </button>
  );
}

export function MenuSeparator(): ReactNode {
  return <hr className="popover-separator" />;
}
