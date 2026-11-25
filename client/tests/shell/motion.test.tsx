import { render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EASE_SPRING, canAnimate, playThen, useFlipList } from '../../src/shell/motion.ts';
import { Popover } from '../../src/shell/popover.tsx';

function List({ keys }: { keys: string[] }): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  useFlipList(list, keys);
  return <ul ref={list}>{keys.map((key) => <li key={key}>{key}</li>)}</ul>;
}

function installMotion(reduce: boolean): ReturnType<typeof vi.fn> {
  const animate = vi.fn(() => ({ onfinish: null, oncancel: null }) as unknown as Animation);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
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

describe('motion utilities', () => {
  it('popover enters with gentle scale-up and spring from anchor corner', () => {
    const animate = installMotion(false);
    render(<Popover anchor={{ left: 20, top: 20, right: 80, bottom: 40 }} align="end" label="菜单" role="menu"
      onClose={() => undefined}><button type="button">一项</button></Popover>);
    const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(String(frames[0]?.transform)).toContain('scale(0.96)');
    expect(options.easing).toBe(EASE_SPRING);
    expect(document.querySelector<HTMLElement>('[role="menu"]')?.style.transformOrigin).toBe('right top');
  });

  it('reorder translates moved items from old rect, fades new items, skips initial render', () => {
    const animate = installMotion(false);
    const view = render(<List keys={['a', 'b', 'c']} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<List keys={['c', 'a', 'b', 'd']} />);
    const moved = animate.mock.calls.map((call) => (call as unknown[])[0] as Keyframe[]);
    expect(moved.some((frames) => String(frames[0]?.transform).includes('translate(0px, 80px)'))).toBe(true);
    expect(moved.some((frames) => frames[0]?.opacity === 0)).toBe(true);
  });

  it('reduced motion disables animations and runs on-finish callbacks immediately', () => {
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

  it('environments without element.animate (jsdom) skip animations safely', () => {
    const then = vi.fn();
    playThen(document.createElement('div'), [{ opacity: 1 }, { opacity: 0 }], 180, then);
    expect(then).toHaveBeenCalledTimes(1);
  });
});
