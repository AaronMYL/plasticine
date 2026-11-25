import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceServiceStatus, ServerStatus, UpdateStatus } from '../../../src/api/shared.ts';
import { renderApp } from '../../helpers.tsx';

type Host = Omit<Window, 'plasticineDesktop'> & { plasticineDesktop?: unknown;
  __plasticineDesktopEvent?: (event: unknown) => void };

function server(change: Partial<ServerStatus> = {}): ServerStatus {
  return { choice: { mode: 'remote', remoteUrl: 'https://you.cyberhunter.top/' }, bundled: true,
    local: 'stopped', problem: null, loaded: 'https://you.cyberhunter.top/', ...change };
}

function update(change: Partial<UpdateStatus> = {}): UpdateStatus {
  return { version: '2026.1108.93012', state: 'up_to_date', available: null, previous: null,
    checkedAt: '2026-11-08T01:00:00.000Z', problem: null, ...change };
}

function device(change: Partial<DeviceServiceStatus> = {}): DeviceServiceStatus {
  return { state: 'online', server: 'https://you.cyberhunter.top/', capabilities: ['file_read'], missing: [],
    problem: null, ...change };
}

function fakeShell(options: { server?: ServerStatus; update?: UpdateStatus; device?: DeviceServiceStatus;
  platform?: 'macos' | 'windows' } = {}) {
  const shell = {
    version: '2026.1108.93012',
    platform: options.platform ?? 'macos',
    server: { status: vi.fn(async () => options.server ?? server()),
      choose: vi.fn(async (choice: ServerStatus['choice']) => server({ choice, loaded: '' })) },
    updates: { status: vi.fn(async () => options.update ?? update()), check: vi.fn(async () => update()),
      download: vi.fn(async () => update({ state: 'ready', available: '2026.1109.10203' })),
      install: vi.fn(), rollback: vi.fn() },
    device: { status: vi.fn(async () => options.device ?? device()),
      pair: vi.fn(async () => device()), pause: vi.fn(async (paused: boolean) => device({ state: paused ? 'paused'
        : 'online' })), openPermission: vi.fn() },
    notifications: { enabled: vi.fn(async () => true), setEnabled: vi.fn(async (enabled: boolean) => enabled) },
  };
  (window as unknown as Host).plasticineDesktop = shell;
  return shell;
}

async function openSystem(): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name: '系统' }));
  return sheet;
}

afterEach(() => {
  delete (window as unknown as Host).plasticineDesktop;
  delete (window as unknown as Host).__plasticineDesktopEvent;
});

describe('Settings - System - Desktop client', () => {
  it('hides desktop client sections on web and mobile', async () => {
    await renderApp();
    const sheet = await openSystem();
    await within(sheet).findByRole('region', { name: '日历和提醒事项' });
    expect(within(sheet).queryByRole('region', { name: 'Plasticine 跑在哪' })).toBeNull();
    expect(within(sheet).queryByRole('region', { name: '这台电脑' })).toBeNull();
  });

  it('switching host confirms with persistent no-data-migration note before handing off to shell', async () => {
    const shell = fakeShell();
    await renderApp();
    const sheet = await openSystem();
    const place = await within(sheet).findByRole('region', { name: 'Plasticine 跑在哪' });
    expect(within(place).getByText('换过去不搬数据；两边的数据各是各的。')).toBeTruthy();
    expect(within(place).getByText('you.cyberhunter.top')).toBeTruthy();
    expect(within(place).getByText('已连上')).toBeTruthy();
    expect((within(place).getByRole('radio', { name: /远程/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(place).getByRole('radio', { name: /这台 Mac/ }));
    expect(shell.server.choose).not.toHaveBeenCalled();
    fireEvent.click(within(place).getByRole('button', { name: '换到这台 Mac' }));
    await waitFor(() => expect(shell.server.choose).toHaveBeenCalledWith({ mode: 'this_computer',
      remoteUrl: 'https://you.cyberhunter.top/' }));
  });

  it('remote card requires entering server address before switching', async () => {
    const shell = fakeShell({ server: server({ choice: { mode: 'this_computer', remoteUrl: null }, local: 'running',
      loaded: 'http://127.0.0.1:8790/' }), platform: 'windows' });
    await renderApp();
    const sheet = await openSystem();
    const place = await within(sheet).findByRole('region', { name: 'Plasticine 跑在哪' });
    expect(within(place).getByText('在运行')).toBeTruthy();
    expect(within(place).getByText('关机就停')).toBeTruthy();
    fireEvent.click(within(place).getByRole('radio', { name: /远程/ }));
    fireEvent.click(within(place).getByRole('button', { name: '换到远程' }));
    expect(await within(place).findByRole('alert')).toBeTruthy();
    fireEvent.change(within(place).getByRole('textbox', { name: '远程地址' }), { target: { value: 'a.example.com' } });
    fireEvent.click(within(place).getByRole('button', { name: '换到远程' }));
    await waitFor(() => expect(shell.server.choose).toHaveBeenCalledWith({ mode: 'remote',
      remoteUrl: 'a.example.com' }));
  });

  it('shows Reopen once update downloaded and delegates system notification toggle to shell', async () => {
    const shell = fakeShell({ update: update({ state: 'ready', available: '2026.1109.10203' }) });
    await renderApp();
    const sheet = await openSystem();
    const computer = await within(sheet).findByRole('region', { name: '这台电脑' });
    expect(await within(computer).findByText('2026.1109.10203')).toBeTruthy();
    fireEvent.click(await within(computer).findByRole('button', { name: '重新打开' }));
    await waitFor(() => expect(shell.updates.install).toHaveBeenCalled());
    const notifications = within(computer).getByRole('switch', { name: '系统通知' }) as HTMLInputElement;
    await waitFor(() => expect(notifications.checked).toBe(true));
    fireEvent.click(notifications);
    await waitFor(() => expect(shell.notifications.setEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(notifications.checked).toBe(false));
  });

  it('tracks shell-reported state updates such as downloaded update', async () => {
    fakeShell();
    await renderApp();
    const sheet = await openSystem();
    const computer = await within(sheet).findByRole('region', { name: '这台电脑' });
    await within(computer).findByText('Plasticine 2026.1108.93012');
    (window as unknown as Host).__plasticineDesktopEvent?.({ type: 'update',
      status: update({ state: 'ready', available: '2026.1109.10203' }) });
    expect(await within(computer).findByRole('button', { name: '重新打开' })).toBeTruthy();
  });

  it('computer control pairs on enable, pauses on disable when paired, and flags missing screen perm', async () => {
    const shell = fakeShell({ device: device({ state: 'unpaired', server: null }) });
    await renderApp();
    const sheet = await openSystem();
    const computer = await within(sheet).findByRole('region', { name: '这台电脑' });
    const toggle = await within(computer).findByRole('switch', { name: '让 Plasticine 用这台电脑' });
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(shell.device.pair).toHaveBeenCalledTimes(1));
    const code = (shell.device.pair.mock.calls[0] as unknown as [{ code: string }])[0].code;
    expect(code.length).toBeGreaterThan(3);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect(shell.device.pause).toHaveBeenCalledWith(true));
    expect(await within(computer).findByText('暂停了')).toBeTruthy();
  });

  it('missing screen permission shows Authorize row delegating to shell System Settings', async () => {
    const shell = fakeShell({ device: device({ missing: ['screen', 'calendar'] }) });
    await renderApp();
    const sheet = await openSystem();
    const computer = await within(sheet).findByRole('region', { name: '这台电脑' });
    expect(await within(computer).findByText('截屏没授权')).toBeTruthy();
    fireEvent.click(within(computer).getByRole('button', { name: '去授权' }));
    expect(shell.device.openPermission).toHaveBeenCalledWith('screen');
  });

  it('places Calendar and Reminders after This computer on desktop', async () => {
    fakeShell();
    await renderApp();
    const sheet = await openSystem();
    const computer = await within(sheet).findByRole('region', { name: '这台电脑' });
    const calendar = within(sheet).getByRole('region', { name: '日历和提醒事项' });
    const version = within(sheet).queryByRole('region', { name: '运行情况' });
    expect(computer.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (version !== null) {
      expect(calendar.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
