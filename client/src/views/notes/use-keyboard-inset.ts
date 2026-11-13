// 手机上键盘弹起来占了多高（11-13 笔记键盘上方的 AI 行）：浏览器不会把 position: fixed 的东西顶到键盘上面，
// 这里读 visualViewport 算出被键盘盖住的高度，写成元素上的 --keyboard-inset，样式用它当 bottom。
// 没有 visualViewport（旧浏览器、测试）就是 0：那一行贴着屏幕底。

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
      element.style.setProperty('--keyboard-inset', `${keyboardInset(view, window.innerHeight)}px`);
    };
    apply();
    view.addEventListener('resize', apply);
    view.addEventListener('scroll', apply);
    return () => {
      view.removeEventListener('resize', apply);
      view.removeEventListener('scroll', apply);
      element.style.removeProperty('--keyboard-inset');
    };
  }, [target, active]);
}
