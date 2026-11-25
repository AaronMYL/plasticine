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

describe('desktop client titlebar', () => {
  it('web build omits titlebar and keeps source-name top bar in feed', async () => {
    const { view: { container } } = await renderApp({ hash: '#/feed' });
    expect(container.querySelector('.titlebar')).toBeNull();
    expect(container.querySelector('.shell')?.hasAttribute('data-titled')).toBe(false);
    expect(container.querySelector('.feed-top')).not.toBeNull();
  });

  it('Mac insets traffic-light width (none in fullscreen), shows page title and back/forward', async () => {
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
    expect(document.querySelector('.rail-lights')).toBeNull();
  });

  it('secondary toggle moves into titlebar (same as Cmd+\\) and disables on Home', async () => {
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

  it('Windows reserves reported right caption-button inset and updates on resize', async () => {
    desktop({ trafficLightInset: 0, fullScreen: false, controlsRight: 138 });
    await renderApp();
    expect(titlebar().style.getPropertyValue('--titlebar-controls')).toBe('138px');
    expect(titlebar().style.getPropertyValue('--titlebar-lights')).toBe('12px');
    act(() => window.__plasticineWindowChrome?.({ trafficLightInset: 0, fullScreen: false, controlsRight: 120 }));
    expect(titlebar().style.getPropertyValue('--titlebar-controls')).toBe('120px');
  });

  it('feed places source name in titlebar and removes redundant main-pane header', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/feed' });
    expect(container.querySelector('.feed-top')).toBeNull();
    expect(within(titlebar()).getByText('信息流')).toBeTruthy();
  });

  it('space page puts Ask Plasticine, edit, overflow in titlebar right; letters put Reply', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/books/space/sp_cog_1',
      setup: (fake) => fake.control.spaces.seed() });
    const actions = titlebar().querySelector<HTMLElement>('.titlebar-actions')!;
    expect(await within(actions).findByRole('button', { name: '让 Plasticine 改' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '改字' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: /的更多操作$/ })).toBeTruthy();
    expect(within(titlebar()).getByText(/^认知科学与意识研究周报｜第1期/)).toBeTruthy();
    expect(container.querySelector('.space-top')).toBeNull();
    act(() => {
      window.location.hash = '#/books/space/sp_letter_dream';
    });
    expect(await within(actions).findByRole('button', { name: '回信' })).toBeTruthy();
  });

  it('Plasticine chat shows title in titlebar and moves search and more buttons to right', async () => {
    desktop({ trafficLightInset: 96, fullScreen: false });
    const { view: { container } } = await renderApp({ hash: '#/plasticine' });
    const actions = titlebar().querySelector<HTMLElement>('.titlebar-actions')!;
    expect(within(actions).getByRole('button', { name: '在记录里找' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '更多' })).toBeTruthy();
    expect(within(titlebar()).getByText('主线')).toBeTruthy();
    expect(container.querySelector('.messages-thread-head')).toBeNull();
  });
});
