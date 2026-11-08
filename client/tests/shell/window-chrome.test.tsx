// 桌面客户端顶上一条的不可拖动区（11-07 两层侧栏）：窗口顶上 44px 里不在 noDrag 里的点击壳一律当拖窗口，所以顶上那几块
// （图标栏顶、第二栏顶、主区顶栏，都标 data-titlebar）里的按钮、输入框要报成不可拖动；别处的按钮、压在 44 以下的不报；
// 标了 data-no-drag 的整块算一块。顶上那几块变了就重报，没变不重复报。

import { act, render, waitFor } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitlebarLayout, WebTabFrame } from '../../src/api/shared.ts';
import { collectTitlebar, useTitlebarReport } from '../../src/shell/window-chrome.ts';

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
  const root = useRef<HTMLDivElement>(null);
  useTitlebarReport(root, revision);
  return <div ref={root}>{children}</div>;
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

describe('顶上一条的不可拖动区', () => {
  it('只报 data-titlebar 那几块里、压在顶上 44 以内的按钮和输入框；data-no-drag 的整块算一块', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-titlebar><button data-frame="90,14,28,28">新旁聊</button></div>
      <div data-titlebar><input data-frame="84,14,227,34"><button data-frame="84,60,40,40">在下面</button></div>
      <div data-titlebar><div data-no-drag data-frame="400,8,600,32"><button data-frame="410,10,20,20">里面</button>
      </div></div>
      <button data-frame="20,10,40,40">不在顶上那几块里</button>`;
    expect(collectTitlebar(root)).toEqual([
      { x: 90, y: 14, width: 28, height: 28 },
      { x: 84, y: 14, width: 227, height: 34 },
      { x: 400, y: 8, width: 600, height: 32 },
    ]);
  });

  it('挂上就报一次；顶上那块里的按钮变了重报；几何没变不重复报', async () => {
    const view = render(<Harness revision="a"><div data-titlebar><button data-frame="10,10,20,20">一</button></div>
    </Harness>);
    expect(titlebar).toHaveBeenCalledTimes(1);
    expect(titlebar.mock.calls[0]?.[0]).toEqual({ height: 44, noDrag: [{ x: 10, y: 10, width: 20, height: 20 }] });
    const button = view.container.querySelector('button')!;
    act(() => button.setAttribute('data-frame', '10,10,40,20'));
    await waitFor(() => expect(titlebar).toHaveBeenCalledTimes(2));
    act(() => button.setAttribute('title', '只改了字'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(titlebar).toHaveBeenCalledTimes(2);
  });

  it('换栏目、换页（revision 变）就重新找顶上那几块再报', () => {
    const view = render(<Harness revision="a"><div data-titlebar><button data-frame="10,10,20,20">一</button></div>
    </Harness>);
    view.rerender(<Harness revision="b"><div data-titlebar><button data-frame="50,10,20,20">二</button></div>
    </Harness>);
    expect(titlebar.mock.calls.at(-1)?.[0].noDrag).toEqual([{ x: 50, y: 10, width: 20, height: 20 }]);
  });
});
