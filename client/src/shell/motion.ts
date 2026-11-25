import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export const MOTION = { fast: 120, base: 180, slow: 260 } as const;
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const EASE_SPRING = 'cubic-bezier(0.3, 1.3, 0.6, 1)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function canAnimate(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.animate === 'function' && !prefersReducedMotion();
}

export function play(element: Element | null, keyframes: Keyframe[], duration: number,
  easing: string = EASE_OUT): Animation | null {
  if (!canAnimate(element)) {
    return null;
  }
  return element.animate(keyframes, { duration, easing });
}

export function playThen(element: Element | null, keyframes: Keyframe[], duration: number, then: () => void): void {
  const animation = play(element, keyframes, duration, EASE_IN_OUT);
  if (animation === null) {
    then();
    return;
  }
  let done = false;
  const finish = (): void => {
    if (!done) {
      done = true;
      then();
    }
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

export const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateY(4px)' },
  { opacity: 1, transform: 'translateY(0)' },
];

export function exitKeyframes(height: number): Keyframe[] {
  return [
    { opacity: 1, height: `${height}px` },
    { opacity: 0, height: '0px' },
  ];
}

export function useFlipList(container: RefObject<HTMLElement | null>, keys: readonly string[]): void {
  const previous = useRef<Map<string, DOMRect>>(new Map());
  const lastSignature = useRef<string | null>(null);
  const signature = keys.join('\u0000');
  useLayoutEffect(() => {
    const root = container.current;
    if (root === null) {
      return;
    }
    const items = [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    const keyOf = (item: HTMLElement): string => keys[items.indexOf(item)] ?? '';
    const next = new Map<string, DOMRect>();
    for (const item of items) {
      next.set(keyOf(item), item.getBoundingClientRect());
    }
    const before = previous.current;
    const changed = lastSignature.current !== null && lastSignature.current !== signature;
    lastSignature.current = signature;
    if (changed && before.size > 0) {
      for (const item of items) {
        const key = keyOf(item);
        const old = before.get(key);
        const now = next.get(key);
        if (old === undefined) {
          play(item, ENTER_KEYFRAMES, MOTION.base);
        } else if (now !== undefined && (old.left !== now.left || old.top !== now.top)) {
          play(item, [
            { transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` },
            { transform: 'translate(0, 0)' },
          ], MOTION.slow);
        }
      }
    }
    previous.current = next;
  });
}

export function useHeightMorph(ref: RefObject<HTMLElement | null>, key: string): void {
  const height = useRef(0);
  const lastKey = useRef(key);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || lastKey.current === key) {
      return;
    }
    lastKey.current = key;
    const from = height.current;
    if (running.current !== null) {
      running.current.cancel();
      running.current = null;
      element.style.overflow = '';
    }
    const to = element.getBoundingClientRect().height;
    height.current = to;
    if (from <= 0 || from === to) {
      return;
    }
    const animation = play(element, [{ height: `${from}px` }, { height: `${to}px` }], MOTION.slow, EASE_IN_OUT);
    if (animation === null) {
      return;
    }
    running.current = animation;
    element.style.overflow = 'hidden';
    const settle = (): void => {
      if (running.current === animation) {
        running.current = null;
        element.style.overflow = '';
      }
    };
    animation.onfinish = settle;
    animation.oncancel = settle;
    for (const child of element.children) {
      play(child, [{ opacity: 0 }, { opacity: 1 }], MOTION.base);
    }
  });
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return undefined;
    }
    height.current = element.getBoundingClientRect().height;
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      height.current = element.getBoundingClientRect().height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}
