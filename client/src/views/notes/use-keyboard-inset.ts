// 手机上键盘弹起来占了多高（11-13 笔记键盘上方的 AI 行）：浏览器不会把 position: fixed 的东西顶到键盘上面，
// 这里读 visualViewport 算出被键盘盖住的高度；那一行平时贴在底栏上面（样式定的 bottom），键盘比底栏高时
// 再往上挪键盘多出来的那一截（transform，不改布局）。没有 visualViewport（旧浏览器、测试）就不挪。

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
