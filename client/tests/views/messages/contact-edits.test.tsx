import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, toolGroups, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: toolGroups.inbox, network, visibility }, NOW);
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

describe('Messages - Reactions and quotes', () => {
  it('shows contact reaction below message, increments to 2 on click, and hover bar adds another', async () => {
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

  it('AI messages omit reactions and quotes; quoting contact adds reply chip and quotes in bubble', async () => {
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

describe('Messages - Manage contacts', () => {
  it('row menu renames alias inline and clearing reverts to contact\'s own name', async () => {
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

  it('deleting contact confirms with consequences, moves to Recently Deleted, and restores to list', async () => {
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

describe('Messages - Memory in profile sidebar', () => {
  it('prompts to bind matching memory page when unbound; confirming binds and links to memory', async () => {
    const app = await open('#/messages/c_zhouke');
    const profile = await screen.findByRole('complementary', { name: '周可的资料' });
    const memory = await within(profile).findByRole('region', { name: '记忆' });
    expect(within(memory).getByText('周可 是记忆里的「周可」吗？')).toBeTruthy();
    fireEvent.click(within(memory).getByRole('button', { name: '是的' }));
    await waitFor(() => expect(app.control.contacts.people.get('c_zhouke')?.personDocId).toBe('doc_person_zhou'));
    const link = await within(memory).findByRole('link', { name: '周可' });
    expect(link.getAttribute('href')).toBe('#/memory/topics/doc_person_zhou');
  });

  it('bound person page shows recent lines labeled with speaker name', async () => {
    await open('#/messages/c_linyi');
    const profile = await screen.findByRole('complementary', { name: '林一的资料' });
    const memory = await within(profile).findByRole('region', { name: '记忆' });
    expect(within(memory).getByText('在做直播带货，主播是自己').closest('li')?.textContent).toMatch(/林一说的/);
    expect(within(memory).getByText('周五下午一般有空').closest('li')?.textContent).toMatch(/你说的/);
  });

  it('Choose another lists person pages with link status and allows creating a new page', async () => {
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
