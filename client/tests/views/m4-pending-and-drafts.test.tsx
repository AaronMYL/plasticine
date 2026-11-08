// M2 客户端审查挡过的几条 P1 在 M4 页面上的样子：结果不明的操作重试时原样重发存下的请求体、没了结时同一处不让输入新内容；
// 那一条离开列表后核实入口还在（页顶单独列）；就地写的字按 id 存进 sessionStorage，切页、刷新都在，两条之间不串字，
// 算进离开提醒。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, settle } from '../helpers.tsx';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function leaveAsks(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('M4 · 结果不明的操作：原样重发，没了结时不让输入新内容', () => {
  it('不感兴趣的回执不确定：不感兴趣锁住；「再核实」原样重发，落定后这一条就地收成可撤销的占位', async () => {
    const app = await renderApp({
      hash: '#/feed',
      setup: (fake) => fake.control.feed.seedItem({ id: 'f_1', title: '一篇' }),
    });
    await settle();
    const react = vi.spyOn(app.api.feed, 'react');
    app.control.faults.next('feed', { kind: 'uncertain', landed: false });
    const item = within(main()).getByRole('listitem', { name: '一篇' });
    fireEvent.click(within(item).getByRole('button', { name: '不感兴趣' }));
    await waitFor(() => expect(within(item).getByRole('button', { name: '不感兴趣' })).toHaveProperty('disabled', true));
    fireEvent.click(within(item).getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(within(item).getByRole('button', { name: '撤销' })).toBeTruthy());
    expect(react.mock.calls[1]).toEqual(react.mock.calls[0]);
  });
});

describe('M4 · 就地写的字按 id 存', () => {
  it('今日设置写到一半：关设置先问，继续编辑还在，算进离开提醒；存上之后草稿清掉、今日按新上限读', async () => {
    const app = await renderApp();
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
    const sheet = (): HTMLElement => screen.getByRole('dialog', { name: '设置' });
    const limit = async (): Promise<HTMLElement> => {
      fireEvent.click(within(sheet()).getByRole('button', { name: '日常' }));
      return within(sheet()).findByLabelText('十件事最多列几条');
    };
    fireEvent.change(await limit(), { target: { value: '5' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: '关掉设置' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '继续编辑' }));
    expect(within(sheet()).getByLabelText('十件事最多列几条')).toHaveProperty('value', '5');
    expect(leaveAsks()).toBe(true);
    fireEvent.change(within(sheet()).getByLabelText('离开多久算「回来」（小时）'), { target: { value: '0' } });
    expect(within(sheet()).getByRole('button', { name: '保存' })).toHaveProperty('disabled', true);
    fireEvent.change(within(sheet()).getByLabelText('离开多久算「回来」（小时）'), { target: { value: '6' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(app.state.inlineDrafts.hasAny()).toBe(false));
    expect(await app.api.today.settings()).toMatchObject({ briefLimit: 5, returnThresholdHours: 6, version: 1 });
  });
});
