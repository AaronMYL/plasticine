// 侧栏更新按钮（11-12）：只在桌面客户端、查到新版时出；点了才下，圆形进度跟着壳报的已下 / 总共走，
// 下好存好笔记直接交给壳重开；没下成换成重试，点了重下。网页里、没有新版时不出也不占位置。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../src/api/shared.ts';
import { renderApp } from '../helpers.tsx';

type Host = Omit<Window, 'plasticineDesktop'> & { plasticineDesktop?: unknown;
  __plasticineDesktopEvent?: (event: unknown) => void };

function update(change: Partial<UpdateStatus> = {}): UpdateStatus {
  return { version: '2026.1112.85836', state: 'up_to_date', available: null, previous: null,
    checkedAt: '2026-11-12T01:00:00.000Z', problem: null, progress: null, ...change };
}

function fakeShell(initial: UpdateStatus, download: () => Promise<UpdateStatus>) {
  const shell = {
    version: '2026.1112.85836', platform: 'macos',
    server: { status: vi.fn(async () => ({ choice: { mode: 'remote', remoteUrl: 'https://you.example/' },
      bundled: true, local: 'stopped', problem: null, loaded: 'https://you.example/' })), choose: vi.fn() },
    updates: { status: vi.fn(async () => initial), check: vi.fn(async () => initial), download: vi.fn(download),
      install: vi.fn(), rollback: vi.fn() },
    device: { status: vi.fn(async () => ({ state: 'online', server: null, capabilities: [], missing: [],
      problem: null })), pair: vi.fn(), pause: vi.fn(), openPermission: vi.fn() },
    notifications: { enabled: vi.fn(async () => true), setEnabled: vi.fn() },
  };
  (window as unknown as Host).plasticineDesktop = shell;
  return shell;
}

function rail(): HTMLElement {
  return screen.getByRole('navigation', { name: '栏目' });
}

function push(status: UpdateStatus): void {
  act(() => (window as unknown as Host).__plasticineDesktopEvent?.({ type: 'update', status }));
}

afterEach(() => {
  delete (window as unknown as Host).plasticineDesktop;
  delete (window as unknown as Host).__plasticineDesktopEvent;
});

describe('侧栏更新按钮', () => {
  it('网页里没有；客户端没有新版也没有', async () => {
    await renderApp();
    expect(rail().querySelector('.rail-update')).toBeNull();
    delete (window as unknown as Host).plasticineDesktop;
  });

  it('没有新版不出；查到新版出在搜索上面，点了才下，进度跟着走，下好直接交给壳重开', async () => {
    let finish: (status: UpdateStatus) => void = () => undefined;
    const shell = fakeShell(update(), () => new Promise((resolve) => { finish = resolve; }));
    await renderApp();
    await waitFor(() => expect(shell.updates.status).toHaveBeenCalled());
    expect(rail().querySelector('.rail-update')).toBeNull();
    push(update({ state: 'available', available: '2026.1113.90512' }));
    const button = await within(rail()).findByRole('button', { name: /有新版本 2026.1113.90512/ });
    const foot = button.parentElement as HTMLElement;
    expect(foot.children[1]?.getAttribute('aria-label')).toBe('搜索和切换');
    expect(shell.updates.download).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(shell.updates.download).toHaveBeenCalledTimes(1));
    push(update({ state: 'downloading', available: '2026.1113.90512', progress: { received: 35, total: 100 } }));
    const loading = await within(rail()).findByRole('button', { name: '正在下载 · 35%' });
    expect(loading.querySelector('.rail-update-arc')).not.toBeNull();
    fireEvent.click(loading);
    expect(shell.updates.download).toHaveBeenCalledTimes(1);
    const ready = update({ state: 'ready', available: '2026.1113.90512' });
    push(ready);
    await act(async () => finish(ready));
    await waitFor(() => expect(shell.updates.install).toHaveBeenCalledTimes(1));
  });

  it('没下成：换成重试，悬停写原因，点了重下', async () => {
    const shell = fakeShell(update({ state: 'failed', available: '2026.1113.90512', problem: '更新没下成：网络断了' }),
      async () => update({ state: 'failed', available: '2026.1113.90512', problem: '更新没下成：网络断了' }));
    await renderApp();
    const retry = await within(rail()).findByRole('button', { name: '更新没下成：网络断了 · 点一下重试' });
    expect(retry.querySelector('.rail-update-dot')).not.toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(shell.updates.download).toHaveBeenCalled());
    expect(shell.updates.install).not.toHaveBeenCalled();
  });
});
