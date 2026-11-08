// 桌面客户端的标题栏（11-08）：Swift Mac App 认不了 -webkit-app-region，标题栏里按钮、输入框的矩形要报给它（其余当拖窗口）；
// 压在 44 以下的不报。标题栏里变了就重报，没变不重复报。Electron 壳没有 titlebar()，不报。

import { act, render, waitFor } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitlebarLayout, WebTabFrame } from '../../src/api/shared.ts';
import { collectNoDrag, useTitlebarReport } from '../../src/shell/window-chrome.ts';

function box(frame: WebTabFrame): DOMRect {
  return { left: frame.x, top: frame.y, width: frame.width, height: frame.height, x: frame.x, y: frame.y,
    right: frame.x + frame.width, bottom: frame.y + frame.height, toJSON: () => ({}) } as DOMRect;
}

/** jsdom 没有布局：按 data-frame 给矩形。 */
function fakeLayout(this: Element): DOMRect {
  const raw = this.getAttribute('data-frame');
  if (raw === null) return box({ x: 0, y: 0, width: 0, height: 0 });
  const [x, y, width, height] = raw.split(',').map(Number) as [number, number, number, number];
  return box({ x, y, width, height });
}

const titlebar = vi.fn<(layout: TitlebarLayout) => void>();

function Harness({ revision, children }: { revision: string; children: ReactNode }): ReactNode {
  const root = useRef<HTMLElement>(null);
  useTitlebarReport(root, revision);
  return <header ref={root}>{children}</header>;
}

beforeEach(() => {
  titlebar.mockReset();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fakeLayout);
  window.plasticineDesktop = { version: '0.3.0', notify: vi.fn(), windowChrome: {
    current: () => ({ trafficLightInset: 78, fullScreen: false }), titlebar } };
});

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

describe('标题栏的不可拖动区（Swift Mac App）', () => {
  it('报标题栏里压在 44 以内的按钮、输入框、链接；44 以下的、没大小的不报', () => {
    const root = document.createElement('header');
    root.innerHTML = `
      <button data-frame="96,8,28,28">后退</button>
      <input data-frame="300,6,200,32">
      <a href="#" data-frame="600,8,28,28">链接</a>
      <button data-frame="84,60,40,40">在下面</button>
      <button>没大小</button>`;
    expect(collectNoDrag(root)).toEqual([
      { x: 96, y: 8, width: 28, height: 28 },
      { x: 300, y: 6, width: 200, height: 32 },
      { x: 600, y: 8, width: 28, height: 28 },
    ]);
  });

  it('挂上就报一次；标题栏里的按钮变了重报；几何没变不重复报', async () => {
    const view = render(<Harness revision="a"><button data-frame="10,10,20,20">一</button></Harness>);
    expect(titlebar).toHaveBeenCalledTimes(1);
    expect(titlebar.mock.calls[0]?.[0]).toEqual({ height: 44, noDrag: [{ x: 10, y: 10, width: 20, height: 20 }] });
    const button = view.container.querySelector('button')!;
    act(() => button.setAttribute('data-frame', '10,10,40,20'));
    await waitFor(() => expect(titlebar).toHaveBeenCalledTimes(2));
    act(() => button.setAttribute('title', '只改了字'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(titlebar).toHaveBeenCalledTimes(2);
  });

  it('Electron 壳没有 titlebar()：什么都不报，也不出错', () => {
    window.plasticineDesktop = { version: '0.9.0', notify: vi.fn(), windowChrome: {
      current: () => ({ trafficLightInset: 96, fullScreen: false }) } };
    render(<Harness revision="a"><button data-frame="10,10,20,20">一</button></Harness>);
    expect(titlebar).not.toHaveBeenCalled();
  });
});
