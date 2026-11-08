// 交互动效的底子（设计稿 2026-11-03）：列表重排时挪了位的从旧位置平移、新来的淡入；开了「减少动态效果」或环境里
// 没有 element.animate 时一律不动，直接停在终点；关标签这类「播完再做」的动作在不能动时立刻做。

import { render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAnimate, playThen, useFlipList } from '../../src/shell/motion.ts';

function List({ keys }: { keys: string[] }): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  useFlipList(list, keys);
  return <ul ref={list}>{keys.map((key) => <li key={key}>{key}</li>)}</ul>;
}

function installMotion(reduce: boolean): ReturnType<typeof vi.fn> {
  const animate = vi.fn(() => ({ onfinish: null, oncancel: null }) as unknown as Animation);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  // 位置按在父元素里排第几算：第 n 个在 top = n × 40。
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const index = this.parentElement === null ? 0 : [...this.parentElement.children].indexOf(this);
    return { left: 0, top: index * 40, width: 100, height: 40, right: 100, bottom: index * 40 + 40, x: 0,
      y: index * 40, toJSON: () => ({}) } as DOMRect;
  });
  window.matchMedia = vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
  return animate;
}

afterEach(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.restoreAllMocks();
});

describe('动效', () => {
  it('重排：挪了位的从旧位置平移过来，新来的淡入；第一次渲染不动', () => {
    const animate = installMotion(false);
    const view = render(<List keys={['a', 'b', 'c']} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<List keys={['c', 'a', 'b', 'd']} />);
    const moved = animate.mock.calls.map((call) => (call as unknown[])[0] as Keyframe[]);
    expect(moved.some((frames) => String(frames[0]?.transform).includes('translate(0px, 80px)'))).toBe(true);
    expect(moved.some((frames) => frames[0]?.opacity === 0)).toBe(true);
  });

  it('开了「减少动态效果」：什么都不动，「播完再做」立刻做', () => {
    const animate = installMotion(true);
    const view = render(<List keys={['a', 'b']} />);
    view.rerender(<List keys={['b', 'a']} />);
    expect(animate).not.toHaveBeenCalled();
    const element = document.createElement('div');
    expect(canAnimate(element)).toBe(false);
    const then = vi.fn();
    playThen(element, [{ opacity: 1 }, { opacity: 0 }], 180, then);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('没有 element.animate 的环境（测试用的 jsdom）也一样不动', () => {
    const then = vi.fn();
    playThen(document.createElement('div'), [{ opacity: 1 }, { opacity: 0 }], 180, then);
    expect(then).toHaveBeenCalledTimes(1);
  });
});
