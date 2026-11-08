// 壳部件：盖在 Mac 网页标签上的浮层报成 hitRegions；交通灯落在图标栏顶上（11-07，全屏不再让、拖动区上报）；
// Windows 的窗口按钮在右上角时主区顶上一行让开。

import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectHitRegions, HIT_REGION_ATTRIBUTE } from '../../src/shell/hit-regions.ts';
import type { TitlebarLayout } from '../../src/api/shared.ts';
import { renderApp } from '../helpers.tsx';

afterEach(() => {
  delete window.plasticineDesktop;
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}) } as DOMRect;
}

describe('盖在网页标签上的浮层（hitRegions）', () => {
  const frame = { x: 216, y: 88, width: 1224, height: 812 };

  function floating(box: DOMRect | null): HTMLElement {
    const element = document.createElement('div');
    if (box !== null) {
      element.setAttribute(HIT_REGION_ATTRIBUTE, 'test');
      element.getBoundingClientRect = () => box;
    }
    document.body.append(element);
    return element;
  }

  it('只报标了 data-hit-region、压在网页那一块上、有大小的浮层', () => {
    const dialog = floating(rect(996, 236, 420, 640));
    const outside = floating(rect(0, 0, 100, 50));
    const hidden = floating(rect(500, 500, 0, 0));
    const plain = floating(null);
    expect(collectHitRegions(document, frame)).toEqual([{ x: 996, y: 236, width: 420, height: 640 }]);
    [dialog, outside, hidden, plain].forEach((element) => element.remove());
    expect(collectHitRegions(document, frame)).toEqual([]);
  });
});

describe('图标栏顶上的交通灯（11-07 两层侧栏）', () => {
  it('网页版不留交通灯的位置，也不报拖动区', async () => {
    const { view: { container } } = await renderApp();
    expect(container.querySelector('.rail')?.getAttribute('data-lights')).toBe('false');
    expect(container.querySelector('.rail-lights')).toBeNull();
  });

  it('Mac App：图标栏顶上让出交通灯；顶上一条的按钮报成不可拖动；进全屏不再让', async () => {
    const titlebar = vi.fn<(layout: TitlebarLayout) => void>();
    window.plasticineDesktop = { version: '0.3.0', notify: vi.fn(), windowChrome: {
      current: () => ({ trafficLightInset: 78, fullScreen: false }), titlebar } };
    const { view: { container } } = await renderApp();
    expect(container.querySelector('.rail-lights')).not.toBeNull();
    expect(titlebar).toHaveBeenCalled();
    expect(titlebar.mock.calls.at(-1)?.[0].height).toBe(44);
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 78, fullScreen: true }));
    expect(container.querySelector('.rail-lights')).toBeNull();
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 'wide' }));
    expect(container.querySelector('.rail-lights')).toBeNull();
  });

  it('Windows 的窗口按钮在右上角：壳报来要让的宽度（不写死），主区顶上一行右边让开；换了宽度跟着换，报 0 不让', async () => {
    window.plasticineDesktop = { version: '0.3.0', notify: vi.fn(), windowChrome: {
      current: () => ({ trafficLightInset: 0, fullScreen: false, controlsRight: 138 }), titlebar: vi.fn() } };
    const { view: { container } } = await renderApp();
    const shell = (): HTMLElement => container.querySelector<HTMLElement>('.shell')!;
    expect(shell().getAttribute('data-window-controls')).toBe('right');
    expect(shell().style.getPropertyValue('--window-controls')).toBe('138px');
    expect(container.querySelector('.rail-lights')).toBeNull();
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 0, fullScreen: false, controlsRight: 120 }));
    expect(shell().style.getPropertyValue('--window-controls')).toBe('120px');
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 0, fullScreen: false, controlsRight: 0 }));
    expect(shell().hasAttribute('data-window-controls')).toBe(false);
    expect(shell().style.getPropertyValue('--window-controls')).toBe('');
  });
});
