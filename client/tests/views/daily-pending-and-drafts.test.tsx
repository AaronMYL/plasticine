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

describe('M4: uncertain operations resend verbatim and block new input until resolved', () => {
  it('uncertain not-interested locks action, recheck resends verbatim, settles to undo slot', async () => {
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

describe('M4: inline text drafts persist per ID', () => {
  it('unsaved timezone prompts on close/unload, keeps draft on continue, bumps version on save', async () => {
    const app = await renderApp();
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
    const sheet = (): HTMLElement => screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(sheet()).getByRole('button', { name: '通用' }));
    fireEvent.click(await within(sheet()).findByRole('switch', { name: '跟随设备' }));
    const field = (): HTMLElement => within(sheet()).getByLabelText('时区名称');
    fireEvent.change(field(), { target: { value: 'Asia/Tokyo' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: '关掉设置' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '继续编辑' }));
    expect(field()).toHaveProperty('value', 'Asia/Tokyo');
    expect(leaveAsks()).toBe(true);
    fireEvent.change(field(), { target: { value: 'Mars/Base' } });
    expect(within(sheet()).getByRole('button', { name: '保存' })).toHaveProperty('disabled', true);
    fireEvent.change(field(), { target: { value: 'Asia/Tokyo' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(app.state.inlineDrafts.hasAny()).toBe(false));
    expect(await app.api.today.settings()).toMatchObject({ timeZone: 'Asia/Tokyo', version: 1 });
  });
});
