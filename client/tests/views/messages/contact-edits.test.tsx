// 第 12 批：人和人的聊天里加表情、引用（回某一句）；消息列表一行的「⋯」改备注、删除联系人和「最近删除」恢复；
// 资料栏「记忆」一节（先问是不是记忆里的某一页、绑上后每行标谁说的）。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, m5b, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
}

async function open(hash: string): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ hash, width: 1440, setup: seed });
  await settle();
  return app;
}

function list(): HTMLElement {
  return screen.getByRole('complementary', { name: '消息' });
}

function rowOf(text: string): HTMLElement {
  return within(list()).getByText(text).closest('.contact-row-item') as HTMLElement;
}

async function messageRow(text: string): Promise<HTMLElement> {
  const log = await screen.findByRole('log', { name: '和林一的聊天记录' });
  const found = await within(log).findByText(text);
  return found.closest('.cm-row') as HTMLElement;
}

describe('消息 · 表情和引用', () => {
  it('对方加的表情在这句下面；点一下我也加一个，数变成 2；悬停条「加个表情」再加一个', async () => {
    const app = await open('#/messages/c_linyi');
    const row = await messageRow('可以，我发一条任务给你。');
    const thumbs = within(row).getByRole('button', { name: /^👍 1/ });
    expect(thumbs.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(thumbs);
    await waitFor(() => expect(within(row).getByRole('button', { name: /^👍 2/ }).getAttribute('aria-pressed'))
      .toBe('true'));
    fireEvent.click(within(row).getByRole('button', { name: '加个表情' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '🎉' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: /^🎉 1/ })).toBeTruthy());
    const entry = app.control.contacts.people.get('c_linyi')?.entries
      .find((item) => item.type === 'message' && item.message.id === 'cm_lin_2');
    expect(entry?.type === 'message' ? entry.message.reactions?.map((r) => r.emoji) : []).toEqual(['👍', '🎉']);
  });

  it('AI 说的话没有表情和引用；对方说的「引用这条」→ 输入框上方一片「回复 林一」，发出去的气泡里写回的哪一句', async () => {
    await open('#/messages/c_linyi');
    const log = await screen.findByRole('log', { name: '和林一的聊天记录' });
    const ai = within(log).getByText('样例收到了，周四晚上交第一版。');
    expect(ai.closest('.cm-row')).toBeNull();
    const row = await messageRow('下周要给品牌方交 10 场直播的复盘，你那边的 Plasticine 能帮我把商单整理成表吗？');
    fireEvent.click(within(row).getByRole('button', { name: '引用这条' }));
    expect(await screen.findByText(/^回复 林一：下周要给品牌方/)).toBeTruthy();
    const input = screen.getByRole('textbox', { name: '发给林一' });
    fireEvent.change(input, { target: { value: '好，这周内给你' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const sent = await within(log).findByText('好，这周内给你', { exact: false });
    const bubble = sent.closest('.cm-bubble') as HTMLElement;
    expect(bubble.querySelector('.cm-reply')?.textContent).toMatch(/^林一：下周要给品牌方/);
    await waitFor(() => expect(screen.queryByText(/^回复 林一：/)).toBeNull());
  });
});

describe('消息 · 管理联系人', () => {
  it('一行的「⋯」：改备注就地改名，清空回到对方自己的名字', async () => {
    await open('#/messages/c_linyi');
    fireEvent.click(within(rowOf('陈默')).getByRole('button', { name: '陈默的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '改备注' }));
    const field = await screen.findByRole('textbox', { name: '陈默的备注' });
    fireEvent.change(field, { target: { value: '默哥' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(within(list()).getByText('默哥')).toBeTruthy());
    fireEvent.click(within(rowOf('默哥')).getByRole('button', { name: '默哥的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '改备注' }));
    const again = await screen.findByRole('textbox', { name: '默哥的备注' });
    fireEvent.change(again, { target: { value: '' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await waitFor(() => expect(within(list()).getByText('陈默')).toBeTruthy());
  });

  it('删除联系人先确认、写清后果；删了进「最近删除」，点恢复回到列表', async () => {
    const app = await open('#/messages/c_linyi');
    fireEvent.click(within(rowOf('阿杰')).getByRole('button', { name: '阿杰的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除联系人' }));
    const dialog = await screen.findByRole('alertdialog', { name: '删除「阿杰」？' });
    expect(dialog.textContent).toMatch(/对方不会收到通知/);
    expect(dialog.textContent).toMatch(/最近删除/);
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(within(list()).queryByText('阿杰')).toBeNull());
    expect(app.control.contacts.people.get('c_ajie')?.relation).toBe('stranger');
    const removed = within(list()).getByRole('button', { name: /最近删除/ });
    expect(removed.textContent).toMatch(/2/);
    fireEvent.click(removed);
    const shelf = within(list()).getByRole('list', { name: '最近删除的联系人' });
    const ajie = within(shelf).getByText('阿杰').closest('li') as HTMLElement;
    fireEvent.click(within(ajie).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(rowOf('阿杰')).toBeTruthy());
  });
});

describe('消息 · 资料栏的记忆', () => {
  it('没绑时先问是不是记忆里的那一页；答「是」就绑上，页名点开到记忆', async () => {
    const app = await open('#/messages/c_zhouke');
    const profile = await screen.findByRole('complementary', { name: '周可的资料' });
    const memory = await within(profile).findByRole('region', { name: '记忆' });
    expect(within(memory).getByText('周可 是记忆里的「周可」吗？')).toBeTruthy();
    fireEvent.click(within(memory).getByRole('button', { name: '是' }));
    await waitFor(() => expect(app.control.contacts.people.get('c_zhouke')?.personDocId).toBe('doc_person_zhou'));
    const link = await within(memory).findByRole('link', { name: '周可' });
    expect(link.getAttribute('href')).toBe('#/memory/topics/doc_person_zhou');
  });

  it('绑了的人物页：最近几行，每行标谁说的（对方说的写名字）', async () => {
    await open('#/messages/c_linyi');
    const profile = await screen.findByRole('complementary', { name: '林一的资料' });
    const memory = await within(profile).findByRole('region', { name: '记忆' });
    expect(within(memory).getByText('在做直播带货，主播是自己').closest('li')?.textContent).toMatch(/林一说的/);
    expect(within(memory).getByText('周五下午一般有空').closest('li')?.textContent).toMatch(/你说的/);
  });

  it('选别的…：列出人物页（已关联写是谁），也能新建一页', async () => {
    const app = await open('#/messages/c_zhouke');
    const profile = await screen.findByRole('complementary', { name: '周可的资料' });
    const memory = await within(profile).findByRole('region', { name: '记忆' });
    fireEvent.click(within(memory).getByRole('button', { name: '选别的…' }));
    const picker = await screen.findByRole('dialog', { name: '选一页人物' });
    expect(within(picker).getByRole('option', { name: /林一.*已关联 林一/ })).toBeTruthy();
    fireEvent.change(within(picker).getByRole('searchbox', { name: '找人物页' }), { target: { value: '小周' } });
    fireEvent.click(within(picker).getByRole('button', { name: '新建人物页「小周」' }));
    await waitFor(() => expect(app.control.contacts.personPages.some((page) => page.title === '小周')).toBe(true));
    expect(await within(memory).findByRole('link', { name: '小周' })).toBeTruthy();
  });
});
