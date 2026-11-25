import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { outboundAsk, outboundGrant, outboundLog } from '../../../src/api/fake/outbound-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('Settings - Privacy and authorizations', () => {
  it('links to Memory -> Promises and authorizations and closes Settings on click', async () => {
    await renderApp({ hash: '#/settings/grants' });
    const dialog = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '隐私与授权' }));
    const section = await within(dialog).findByRole('region', { name: '已经授权的' });
    expect(within(dialog).queryByRole('region', { name: '对外授权' })).toBeNull();
    const link = within(section).getByRole('link', { name: '对外发送、以后直接做的：在记忆 · 承诺和授权' });
    expect(link.getAttribute('href')).toBe('#/memory/topics/memdoc-grants');
    expect(within(dialog).getByRole('region', { name: '先问你' })).toBeTruthy();
  });

  it('hides section when no external authorization exists', async () => {
    await renderApp({ hash: '#/memory/topics/memdoc-grants', setup: ({ control }) => control.memoryTopics.seed() });
    await screen.findByRole('region', { name: /^可以直接做/ });
    expect(screen.queryByRole('region', { name: '对外授权' })).toBeNull();
  });
});

describe('Authorization scope interaction', () => {
  it('main thread cannot borrow another task; grant preserves user-chosen long-term scope', async () => {
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

  it('during-task grant requires picking the initiating background task before confirming', async () => {
    const app = await renderApp({ hash: '#/work/line-proof', setup: ({ control }) => {
      control.lines.put(control.lines.blank('line-proof', 'background', '周报校对',
        { status: 'waiting', activeSince: NOW.toISOString() }));
      control.lines.change('line-main', { status: 'waiting', activeSince: NOW.toISOString() });
      control.asks.raise({ ...outboundAsk(), lineId: 'line-proof' });
    } });
    const [card] = await screen.findAllByRole('region', { name: /对外授权/ });
    if (card === undefined) throw new Error('没画出对外授权卡');
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

  it('out-of-scope sends once without expanding grant and keeps original target and text', async () => {
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

  it('edit list supports newlines, pause/revoke, and viewing original text and unknown outcomes', async () => {
    const app = await renderApp({ hash: '#/memory/topics/memdoc-grants', setup: ({ control }) => {
      control.memoryTopics.seed();
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
    const confirm = screen.getByRole('alertdialog', { name: '撤销这条授权？' });
    expect(within(confirm).getByText(/已经发出的内容不会收回/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: '撤销' }));
    await waitFor(async () => expect((await app.api.outbound.grants())[0]?.revokedAt).not.toBeNull());
    expect(await within(section).findByText('已撤销')).toBeTruthy();
    const logs = screen.getByRole('region', { name: '自动发出的' });
    expect(within(logs).getByText('结果待核实')).toBeTruthy();
    fireEvent.click(within(logs).getByRole('button', { name: '看原文' }));
    expect(logs.querySelector('pre')?.textContent).toBe(outboundLog(NOW).content);
  });
});
