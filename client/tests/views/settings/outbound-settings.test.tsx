import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { outboundAsk, outboundGrant, outboundLog } from '../../../src/api/fake/outbound-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('设置 · 隐私与授权', () => {
  it('对外授权在「隐私与授权」里，空列表说明没有授权', async () => {
    await renderApp({ hash: '#/settings/grants' });
    const dialog = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '隐私与授权' }));
    const section = await within(dialog).findByRole('region', { name: '对外授权' });
    expect(await within(section).findByText('还没有对外授权')).toBeTruthy();
  });
});


describe('授权范围交互', () => {
  it('主线不能借用其他任务；授权保留用户选定的长期范围', async () => {
    const app = await renderApp({ hash: '#/messages/plasticine', setup: ({ control }) => {
      control.contacts.addPerson({ id: 'contact-fern', name: '小蕨', handle: 'fern-example' });
      control.contacts.addPerson({ id: 'contact-river', name: '河川', handle: 'river-example' });
      control.lines.put(control.lines.blank('other-task', 'background', '另一件事'));
      control.lines.change('line-main', { status: 'waiting', activeSince: NOW.toISOString() });
      control.asks.raise(outboundAsk());
    } });
    const card = await screen.findByRole('region', { name: /对外授权/ });
    await waitFor(() => expect(within(card).getByRole('button', { name: '这件事期间' }).hasAttribute('disabled'))
      .toBe(true));
    fireEvent.click(within(card).getByRole('button', { name: '修改发给谁' }));
    expect(await within(card).findByRole('button', { name: '移出名单：小蕨' })).toBeTruthy();
    expect(within(card).queryByRole('textbox', { name: '发送名单' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '一直允许' }));
    fireEvent.click(within(card).getByRole('button', { name: '授权并发出' }));
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.scope).toEqual({ kind: 'always' }));
  });

  it('任务期间要选发起动作的后台任务后才能确认', async () => {
    const app = await renderApp({ hash: '#/work/line-proof', setup: ({ control }) => {
      control.lines.put(control.lines.blank('line-proof', 'background', '周报校对',
        { status: 'waiting', activeSince: NOW.toISOString() }));
      control.lines.change('line-main', { status: 'waiting', activeSince: NOW.toISOString() });
      control.asks.raise({ ...outboundAsk(), lineId: 'line-proof' });
    } });
    const card = await screen.findByRole('region', { name: /对外授权/ });
    await waitFor(() => expect(within(card).getByRole('button', { name: '这件事期间' }).hasAttribute('disabled'))
      .toBe(false));
    fireEvent.click(within(card).getByRole('button', { name: '这件事期间' }));
    expect(within(card).getByRole('button', { name: '授权并发出' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(card).getByRole('combobox', { name: '绑定任务或项目' }),
      { target: { value: 'line:line-proof' } });
    fireEvent.click(within(card).getByRole('button', { name: '授权并发出' }));
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.scope)
      .toEqual({ kind: 'task', binding: { kind: 'line', id: 'line-proof' } }));
  });

  it('超范围只发一次不扩充原授权，保留原始对象和文案', async () => {
    const app = await renderApp({ hash: '#/messages/plasticine', setup: ({ control }) => {
      control.lines.change('line-main', { status: 'waiting', activeSince: NOW.toISOString() });
      const seed = outboundAsk();
      control.outbound.seed([outboundGrant(NOW)]);
      control.asks.raise({ ...seed, outbound: { ...seed.outbound!, relatedGrantId: 'grant-studio' },
        options: [{ id: 'extend', label: '加进授权', recommended: true, description: null },
          { id: 'once', label: '只发这一次', recommended: false, description: null },
          { id: 'deny', label: '先不', recommended: false, description: null }] });
    } });
    const card = await screen.findByRole('region', { name: /对外授权/ });
    fireEvent.click(within(card).getByRole('button', { name: '只发这一次' }));
    await waitFor(async () => expect(await app.api.outbound.grants()).toHaveLength(2));
    const grants = await app.api.outbound.grants();
    expect(grants[0]?.version).toBe(1);
    expect(grants[1]?.scope).toEqual({ kind: 'once' });
    expect(grants[1]?.fixedTexts).toEqual([outboundAsk().outbound!.requested.content]);
  });

  it('编辑名单支持换行；可暂停和撤销，记录原文及未知结果可查看', async () => {
    const app = await renderApp({ hash: '#/settings/grants', setup: ({ control }) => {
      control.outbound.seed([outboundGrant(NOW, { channel: 'douyin.dm' })],
        [outboundLog(NOW, { status: 'unknown' })]);
    } });
    const section = await screen.findByRole('region', { name: '对外授权' });
    const enabled = await within(section).findByRole('switch');
    fireEvent.click(enabled);
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.enabled).toBe(false));
    fireEvent.click(within(section).getByRole('button', { name: /授权操作/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '修改授权' }));
    fireEvent.click(within(section).getByRole('button', { name: '修改发给谁' }));
    const list = within(section).getByRole('textbox', { name: '发送名单' }) as HTMLTextAreaElement;
    fireEvent.change(list, { target: { value: 'contact-one\n' } });
    expect(list.value).toBe('contact-one\n');
    fireEvent.change(list, { target: { value: 'contact-one\ncontact-two' } });
    fireEvent.click(within(section).getByRole('button', { name: '保存授权' }));
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.recipients)
      .toEqual(['contact-one', 'contact-two']));
    fireEvent.click(within(section).getByRole('button', { name: /授权操作/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '撤销授权' }));
    expect(within(section).getByText(/已经发出的内容不会收回/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '确认撤销' }));
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.revokedAt).not.toBeNull());
    expect(await within(section).findByText('已撤销')).toBeTruthy();
    const logs = screen.getByRole('region', { name: '自动发出的' });
    expect(within(logs).getByText('结果待核实')).toBeTruthy();
    fireEvent.click(within(logs).getByRole('button', { name: '看原文' }));
    expect(logs.querySelector('pre')?.textContent).toBe(outboundLog(NOW).content);
  });
});
