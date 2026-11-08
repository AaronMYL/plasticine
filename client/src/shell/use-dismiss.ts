// 非模态浮层（下拉菜单、翻译菜单、小弹层、行尾 ⋯）全站一套关闭逻辑（2026-11-05 第 3 条，用户定「点外面、Esc、
// 切到网页、选完一项都收」）。开着时下面任何一种都关：
// - 在浮层和触发按钮之外按下（捕获阶段的 pointerdown：里面的东西拦了冒泡也照样收得到）；
// - Esc（输入法组字时不算）；
// - 窗口失焦：Mac / iPhone App 里网页标签是原生 WKWebView 垫在主网页下面，点那一块时主网页的 document 收不到
//   pointerdown，只会失焦（原生桥没有「网页被点」的事件，失焦是唯一能接到的信号）；点进 iframe、切到别的 App 也一样；
// - 切标签、换路由（都会改 location.hash）、页面被藏起来；
// - 窗口缩放（焦点在浮层里的输入框时不算：手机弹键盘会改视口）；
// - 滚动：给了锚点就看锚点，挪出视野才关、还在就交给 onAnchorMove 跟着挪；没给锚点时外面一滚就关（浮层贴着的那一点
//   已经跟着内容走了）。浮层自己里面的滚动不算。

import { useEffect, useRef, type RefObject } from 'react';
import { NATIVE_POINTER_EVENT } from '../mac/native-pointer.ts';

export type DismissReason = 'outside' | 'escape' | 'blur' | 'navigate' | 'resize' | 'scroll' | 'hidden';

export interface DismissOptions {
  open: boolean;
  onDismiss: (reason: DismissReason) => void;
  /** 浮层本身和触发按钮：在这些里面按下、滚动不算外面。 */
  inside: readonly RefObject<Element | null>[];
  /** 浮层贴着的东西（一般就是触发按钮）。 */
  anchor?: RefObject<Element | null> | undefined;
  /** 滚动后锚点还在视野里：浮层跟着挪。 */
  onAnchorMove?: (() => void) | undefined;
}

function within(refs: readonly RefObject<Element | null>[], target: EventTarget | null): boolean {
  return target instanceof Node && refs.some((ref) => ref.current?.contains(target) === true);
}

const SCROLLS = /(auto|scroll|hidden|clip)/;

/** 元素还看得见：在视口里，也没被哪一层能滚动 / 裁切的祖先裁掉。 */
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
      if (event.key === 'Escape' && !event.isComposing) {
        event.stopPropagation();
        dismiss('escape');
      }
    };
    const blur = (event: FocusEvent): void => {
      // 只认窗口自己的失焦（元素的 blur 不冒泡，捕获阶段才会经过 window，这里没在捕获阶段听）。
      if (!(event.target instanceof Node)) {
        dismiss('blur');
      }
    };
    // Mac App：点在原生网页标签上，外层收不到 pointerdown，原生层另报一声（mac/native-pointer.ts）。
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
      // 滚的那一块里没有锚点（旁边一栏在滚）：锚点没动。
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
