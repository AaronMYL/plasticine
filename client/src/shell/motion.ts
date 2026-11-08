// 交互动效的公共底子（设计稿 2026-11-03）：时长、缓动和「减少动态效果」的判断都在这里，各处只调这几个函数。
// 只用浏览器自带的 Web Animations（element.animate），不引动画库。开启「减少动态效果」、或者环境没有 animate
// （测试用的 jsdom）时一律不动，直接停在终点：动效只是帮你看清变化，不是功能的一部分。

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** 和 tokens.css 的 --motion-* 一致：按压 120，标签开关 / 切换 / 小浮层 180，形变与补位 260。 */
export const MOTION = { fast: 120, base: 180, slow: 260 } as const;
export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 能不能动：减少动态效果时、没有 animate 的环境里都不动。 */
export function canAnimate(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.animate === 'function' && !prefersReducedMotion();
}

/** 播一段动画；不能动就什么都不做，返回 null。结束后不保留终点样式（终点就是元素本来的样子）。 */
export function play(element: Element | null, keyframes: Keyframe[], duration: number,
  easing: string = EASE_OUT): Animation | null {
  if (!canAnimate(element)) {
    return null;
  }
  return element.animate(keyframes, { duration, easing });
}

/** 播完再做下一步（关标签：先收起再真关）；不能动就立刻做。 */
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

/** 新出现的东西：淡入并从下方 4px 升上来（卡片进入、列表新增一行、页面切换）。 */
export const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateY(4px)' },
  { opacity: 1, transform: 'translateY(0)' },
];

/** 要拿掉的东西：淡出并收起高度（列表删除一行）。 */
export function exitKeyframes(height: number): Keyframe[] {
  return [
    { opacity: 1, height: `${height}px` },
    { opacity: 0, height: '0px' },
  ];
}

/**
 * 列表补位（FLIP）：每次提交后记下各子元素的位置；身份或顺序变了时，挪了位的从旧位置平移回新位置，新来的淡入升起。
 * keys 是子元素按顺序的稳定 id（卡片 id，不用下标），和容器的直接子元素一一对应。
 */
export function useFlipList(container: RefObject<HTMLElement | null>, keys: readonly string[]): void {
  const previous = useRef<Map<string, DOMRect>>(new Map());
  const lastSignature = useRef<string | null>(null);
  const signature = keys.join('\u0000');
  // 每次提交后都记一遍位置（别的原因引起的挪动也算进「上一次」），只有身份或顺序变了才动。
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

/**
 * 同一个元素换了一身内容（信息流卡片收成「不感兴趣 · 撤销」的占位、再展开）：高度从旧的平滑过渡到新的，新内容淡入，
 * 下面的东西跟着挪、不跳。旧高度由 ResizeObserver 一直跟着记（图片晚到也算上）；key 变了才动。
 */
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
