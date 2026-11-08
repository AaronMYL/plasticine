// 桌面客户端的标题栏（11-08《第 7 批》第 1 条，照 ChatGPT 桌面版）：窗口最上面一条，红绿灯让出壳报的宽度、← →、收起
// 第二栏、当前页名，右边放页面的操作；Windows 的窗口按钮在右端，右边让开。网页版没有，页面照旧画自己的页头。

import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WindowChrome } from '../../src/api/shared.ts';
import { renderApp } from '../helpers.tsx';

function desktop(chrome: WindowChrome): void {
  window.plasticineDesktop = { version: '0.9.0', notify: vi.fn(), windowChrome: { current: () => chrome } };
}

function titlebar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('.titlebar');
  if (bar === null) {
    throw new Error('没有标题栏');
  }
  return bar;
}

afterEach(() => {
  delete window.plasticineDesktop;
});

describe('桌面客户端的标题栏', () => {
  it('网页版没有标题栏；信息流照旧画写着来源名的顶栏', async () => {
    const { view: { container } } = await renderApp({ hash: '#/feed' });
    expect(container.querySelector('.titlebar')).toBeNull();
    expect(container.querySelector('.shell')?.hasAttribute('data-titled')).toBe(false);
    expect(container.querySelector('.feed-top')).not.toBeNull();
  });

  it('Mac：左边让出壳报的红绿灯宽度（不写死），全屏不让；写当前页名；← → 跟着浏览记录', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    await renderApp({ hash: '#/notes' });
    const bar = titlebar();
    expect(bar.style.getPropertyValue('--titlebar-lights')).toBe('96px');
    expect(within(bar).getByText('笔记')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '后退' })).toHaveProperty('disabled', true);
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '任务' }));
    expect(within(titlebar()).getByRole('button', { name: '后退' })).toHaveProperty('disabled', false);
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 96, fullScreen: true }));
    expect(titlebar().style.getPropertyValue('--titlebar-lights')).toBe('12px');
    // 图标栏顶上不再留红绿灯的位置（灯在标题栏里）。
    expect(document.querySelector('.rail-lights')).toBeNull();
  });

  it('收起 / 展开第二栏在标题栏里（⌘\\ 同一个），第二栏标题行不再有收起按钮；首页没有第二栏时按不了', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    await renderApp({ hash: '#/notes' });
    const toggle = within(titlebar()).getByRole('button', { name: '收起侧栏' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryAllByRole('button', { name: '收起侧栏' })).toHaveLength(1);
    fireEvent.click(toggle);
    expect(document.querySelector('.shell')?.getAttribute('data-column')).toBe('hidden');
    const expand = within(titlebar()).getByRole('button', { name: '展开侧栏' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('button', { name: '展开侧栏' })).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^(现在|首页)$/ }));
    expect(within(titlebar()).getByRole('button', { name: /侧栏/ })).toHaveProperty('disabled', true);
  });

  it('Windows：窗口按钮在右端，标题栏右边让开壳量出来的宽度；换了跟着换', async () => {
    desktop({ trafficLightInset: 0, fullScreen: false, controlsRight: 138 });
    await renderApp();
    expect(titlebar().style.getPropertyValue('--titlebar-controls')).toBe('138px');
    expect(titlebar().style.getPropertyValue('--titlebar-lights')).toBe('12px');
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 0, fullScreen: false, controlsRight: 120 }));
    expect(titlebar().style.getPropertyValue('--titlebar-controls')).toBe('120px');
  });

  it('信息流：来源名写进标题栏，主区不再画只写来源名的顶栏', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/feed' });
    expect(container.querySelector('.feed-top')).toBeNull();
    expect(within(titlebar()).getByText('全部')).toBeTruthy();
  });

  it('空间页：编辑、订阅设置挪进标题栏右边', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/books/space/sp_research_2',
      setup: (fake) => fake.control.spaces.seed() });
    const actions = titlebar().querySelector<HTMLElement>('.titlebar-actions')!;
    expect(await within(actions).findByRole('button', { name: '订阅设置' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(within(titlebar()).getByText('研究周报 · 第 2 期')).toBeTruthy();
    expect(container.querySelector('.space-top')).toBeNull();
  });

  it('Plasticine 对话：页名在标题栏，在记录里找、更多挪进右边', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/plasticine' });
    const actions = titlebar().querySelector<HTMLElement>('.titlebar-actions')!;
    expect(within(actions).getByRole('button', { name: '在记录里找' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '更多' })).toBeTruthy();
    expect(within(titlebar()).getByText('主线')).toBeTruthy();
    expect(container.querySelector('.messages-thread-head')).toBeNull();
  });
});
