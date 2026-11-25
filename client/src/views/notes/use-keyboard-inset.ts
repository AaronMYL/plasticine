import { useEffect, type RefObject } from 'react';

export function keyboardInset(view: Pick<VisualViewport, 'height' | 'offsetTop'>, windowHeight: number): number {
  return Math.max(0, Math.round(windowHeight - view.height - view.offsetTop));
}

export function useKeyboardInset(target: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const element = target.current;
    const view = typeof window === 'undefined' ? null : window.visualViewport;
    if (element === null || view == null || !active) {
      return undefined;
    }
    const apply = (): void => {
      const bar = document.querySelector<HTMLElement>('.phone-bar')?.offsetHeight ?? 0;
      const lift = Math.max(0, keyboardInset(view, window.innerHeight) - bar);
      element.style.transform = lift === 0 ? '' : `translateY(-${lift}px)`;
    };
    apply();
    view.addEventListener('resize', apply);
    view.addEventListener('scroll', apply);
    return () => {
      view.removeEventListener('resize', apply);
      view.removeEventListener('scroll', apply);
      element.style.transform = '';
    };
  }, [target, active]);
}
