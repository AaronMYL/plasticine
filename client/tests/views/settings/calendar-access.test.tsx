// 设置 · 系统 ·「日历和提醒事项」（第 15 条）：看那台 Mac 给没给完全访问；在 Mac 的 Plasticine 里点「去授权」经壳的助手桥
// 弹系统框（只请求还没给的那几样）；别的设备上只给一个 ⓘ 说去那台 Mac 上点。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function openAccess(): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name: '系统' }));
  return within(sheet).findByRole('region', { name: '日历和提醒事项' });
}

afterEach(() => {
  delete window.plasticineDesktop;
});

describe('设置 · 系统 · 日历和提醒事项', () => {
  it('没连 Mac 只写一句，不给按钮', async () => {
    await renderApp();
    const section = await openAccess();
    expect(within(section).getByText('还没连 Mac')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: '去授权' })).toBeNull();
  });

  it('都给了写已授权', async () => {
    await renderApp({ setup: ({ control }) => {
      control.nodes.addNode('家里的 Mac', ['calendar_list', 'calendar_create', 'reminder_list']);
    } });
    const section = await openAccess();
    expect(await within(section).findByText('已授权')).toBeTruthy();
  });

  it('不在 Mac 上：没授权旁边是 ⓘ', async () => {
    await renderApp({ setup: ({ control }) => {
      control.nodes.addNode('家里的 Mac', ['file_read']);
    } });
    const section = await openAccess();
    expect(await within(section).findByText('没授权')).toBeTruthy();
    expect(within(section).getByRole('button', { name: '「日历和提醒事项」怎么授权' })).toBeTruthy();
  });

  it('在 Mac 上：去授权只请求还没给的，拒了说去系统设置', async () => {
    const call = vi.fn(async (_method: string, params: { kind: string }) => ({ kind: params.kind,
      granted: false, settingsOpened: true }));
    window.plasticineDesktop = { version: '1.0.0', notify: vi.fn(), helper: { call: call as never } };
    await renderApp({ setup: ({ control }) => {
      control.nodes.addNode('家里的 Mac', ['calendar_list']);
    } });
    const section = await openAccess();
    expect(await within(section).findByText('提醒事项没授权')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '去授权' }));
    await waitFor(() => expect(within(section).getByRole('status').textContent).toContain('系统设置'));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('permissions.request', { kind: 'reminders' });
  });
});
