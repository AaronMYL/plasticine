import { useEffect, useRef, type RefObject } from 'react';
import { NATIVE_POINTER_EVENT } from '../mac/native-pointer.ts';

export type DismissReason = 'outside' | 'escape' | 'blur' | 'navigate' | 'resize' | 'scroll' | 'hidden';

export interface DismissOptions {
  open: boolean;
  onDismiss: (reason: DismissReason) => void;
  inside: readonly RefObject<Element | null>[];
  anchor?: RefObject<Element | null> | undefined;
  onAnchorMove?: (() => void) | undefined;
}

function within(refs: readonly RefObject<Element | null>[], target: EventTarget | null): boolean {
  return target instanceof Node && refs.some((ref) => ref.current?.contains(target) === true);
}

const SCROLLS = /(auto|scroll|hidden|clip)/;

export function inView(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  let top = 0;
  let left = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (SCROLLS.test(`${style.overflowX} ${style.overflowY}`)) {
      const clip = parent.getBoundingClientRect();
      top = Math.max(top, clip.top);
      left = Math.max(left, clip.left);
      bottom = Math.min(bottom, clip.bottom);
      right = Math.min(right, clip.right);
    }
  }
  return rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right;
}

function typingInside(refs: readonly RefObject<Element | null>[]): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && within(refs, active)
    && (active.matches('input, textarea, select') || active.isContentEditable);
}

function clearsFirst(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'search' && target.value !== '';
}

export function useDismiss(options: DismissOptions): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!options.open) {
      return undefined;
    }
    const dismiss = (reason: DismissReason): void => {
      if (latest.current.open) {
        latest.current.onDismiss(reason);
      }
    };
    const down = (event: PointerEvent): void => {
      if (!within(latest.current.inside, event.target)) {
        dismiss('outside');
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && !clearsFirst(event.target)) {
        event.stopPropagation();
        dismiss('escape');
      }
    };
    const blur = (event: FocusEvent): void => {
      if (!(event.target instanceof Node)) {
        dismiss('blur');
      }
    };
    const native = (): void => dismiss('outside');
    const navigate = (): void => dismiss('navigate');
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') {
        dismiss('hidden');
      }
    };
    const resize = (): void => {
      if (!typingInside(latest.current.inside)) {
        dismiss('resize');
      }
    };
    const scroll = (event: Event): void => {
      const target = event.target;
      if (within(latest.current.inside, target)) {
        return;
      }
      const anchor = latest.current.anchor?.current ?? null;
      if (anchor === null) {
        dismiss('scroll');
        return;
      }
      if (target instanceof Node && target !== document && !target.contains(anchor)) {
        return;
      }
      if (!inView(anchor)) {
        dismiss('scroll');
      } else {
        latest.current.onAnchorMove?.();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    window.addEventListener(NATIVE_POINTER_EVENT, native);
    window.addEventListener('hashchange', navigate);
    window.addEventListener('popstate', navigate);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
      window.removeEventListener(NATIVE_POINTER_EVENT, native);
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('resize', resize);
    };
  }, [options.open]);
}
