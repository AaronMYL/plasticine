import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientStateProvider, createClientState, type ClientState } from '../../src/state/context.tsx';
import { useRememberedScroll } from '../../src/state/use-remembered-scroll.ts';

/** 内容到了之后的高度、可视高度：可滚的最大距离是两者之差。 */
const CONTENT_HEIGHT = 2000;
const VIEW_HEIGHT = 400;

/**
 * jsdom 没有布局：给测试用的区域装上浏览器的行为——scrollHeight 跟着里面有没有内容变，
 * 设 scrollTop 时夹在 0 到 (scrollHeight - clientHeight) 之间。
 */
function fakeLayout(): void {
  const positions = new WeakMap<HTMLElement, number>();
  const content = (element: HTMLElement): number =>
    element.querySelector('[data-content]') === null ? VIEW_HEIGHT : CONTENT_HEIGHT;
  Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLDivElement) {
      return content(this);
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return VIEW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLDivElement) {
      return positions.get(this) ?? 0;
    },
    set(this: HTMLDivElement, value: number) {
      positions.set(this, Math.max(0, Math.min(value, content(this) - VIEW_HEIGHT)));
    },
  });
}

function restoreLayout(): void {
  for (const property of ['scrollHeight', 'clientHeight', 'scrollTop']) {
    Reflect.deleteProperty(HTMLDivElement.prototype, property);
  }
}

function Pane({ ready }: { ready: boolean }): ReactNode {
  const { ref, onScroll } = useRememberedScroll<HTMLDivElement>('notes:list', ready);
  return (
    <div ref={ref} onScroll={onScroll} data-testid="pane">
      {ready ? <p data-content="">一长串内容</p> : <p>正在读…</p>}
    </div>
  );
}

function withState(state: ClientState, ready: boolean): ReactNode {
  return (
    <ClientStateProvider state={state}>
      <Pane ready={ready} />
    </ClientStateProvider>
  );
}

beforeEach(() => {
  fakeLayout();
});

afterEach(() => {
  restoreLayout();
});

describe('记住滚动位置 · 内容异步读来', () => {
  it('重新挂上时先是加载态：等内容就绪再恢复，不被夹成 0', () => {
    const state = createClientState();
    state.viewScroll.save('notes:list', 900);
    const view = render(withState(state, false));
    expect(screen.getByTestId('pane').scrollTop).toBe(0);
    view.rerender(withState(state, true));
    expect(screen.getByTestId('pane').scrollTop).toBe(900);
  });

  it('加载中就卸掉：不拿加载态的 0 盖掉记下的位置', () => {
    const state = createClientState();
    state.viewScroll.save('notes:list', 900);
    const view = render(withState(state, false));
    view.unmount();
    expect(state.viewScroll.restore('notes:list')).toBe(900);
  });

  it('就绪后的真实滚动事件保存位置，卸掉时不覆盖它', () => {
    const state = createClientState();
    const view = render(withState(state, true));
    const pane = screen.getByTestId('pane');
    pane.scrollTop = 640;
    fireEvent.scroll(pane);
    expect(state.viewScroll.restore('notes:list')).toBe(640);
    view.unmount();
    expect(state.viewScroll.restore('notes:list')).toBe(640);
  });
});
