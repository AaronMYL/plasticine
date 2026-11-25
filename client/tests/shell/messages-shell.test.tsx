import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, toolGroups, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: toolGroups.inbox, network, visibility }, NOW);
}

function waitingSeed(fake: FakeApi): void {
  seed(fake);
  fake.control.asks.raise({ id: 'ask_wait', kind: 'decide', question: '首页卡片按类别还是按项目上色？',
    options: [{ id: 'a', label: '按类别', recommended: true, description: null }] });
}

function phoneBar(): HTMLElement | null {
  return document.querySelector('.phone-bar');
}

describe('mobile bottom bar and message pages', () => {
  it('bottom bar has 5 tabs; More opens drawer with tasks, reading, library, and settings', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: seed });
    await settle();
    const bar = screen.getByRole('navigation', { name: '主导航' });
    expect(within(bar).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['首页', 'Plasticine', '消息', '笔记', '更多']);
    fireEvent.click(within(bar).getByRole('button', { name: '更多' }));
    const drawer = await screen.findByRole('dialog', { name: '更多' });
    expect(within(drawer).getAllByRole('button').map((button) => button.textContent).filter((text) => text !== ''))
      .toEqual(['任务', '阅读', '资料库', '设置']);
    fireEvent.click(within(drawer).getByRole('button', { name: '资料库' }));
    await waitFor(() => expect(window.location.hash).toBe('#/library'));
    expect(within(bar).getByRole('button', { name: '更多' }).getAttribute('aria-current')).toBe('page');
  });

  it('pending items show terracotta dot on More and Tasks in drawer only', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: waitingSeed });
    await settle();
    const bar = (): HTMLElement => screen.getByRole('navigation', { name: '主导航' });
    await waitFor(() => expect(within(bar()).getByRole('button', { name: '更多 · 有等你的事' })).toBeTruthy());
    expect(bar().querySelectorAll('.phone-tab-dot')).toHaveLength(1);
    fireEvent.click(within(bar()).getByRole('button', { name: '更多 · 有等你的事' }));
    const drawer = await screen.findByRole('dialog', { name: '更多' });
    expect(within(drawer).getByRole('button', { name: '任务 · 有等你的事' })).toBeTruthy();
  });

  it('list -> full chat (hides bar/bubble) -> profile page navigates back step by step', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: seed });
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', { name: '消息' }));
    await settle();
    expect(window.location.hash).toBe('#/messages');
    expect(screen.getByRole('group', { name: '筛选' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^展开对话框/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '林一' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_linyi'));
    expect(phoneBar()).toBeNull();
    expect(screen.queryByRole('button', { name: /^展开对话/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: '发给林一' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '发任务' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '林一的资料' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_linyi/profile'));
    expect(screen.getByRole('heading', { name: '林一' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '关系' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回到和林一的聊天' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_linyi'));
    fireEvent.click(screen.getByRole('button', { name: '回到消息' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages'));
    expect(phoneBar()).not.toBeNull();
  });

  it('mobile Plasticine opens main thread with bottom bar and no bubble; roster is top-right', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: seed });
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' }))
      .getByRole('button', { name: 'Plasticine' }));
    await waitFor(() => expect(window.location.hash).toBe('#/plasticine'));
    expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
    expect(phoneBar()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /展开对话框/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '返回主线' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '队友和群组' }));
    const roster = await screen.findByRole('dialog', { name: '队友和群组' });
    expect(within(roster).getByRole('link', { name: '记忆' })).toBeTruthy();
    fireEvent.click(within(roster).getByRole('link', { name: 'Plasticine 主线' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '队友和群组' })).toBeNull());
    expect(window.location.hash).toBe('#/plasticine');
    expect(phoneBar()).not.toBeNull();
  });

  it('chat header sparkle opens dialog to ask Plasticine', async () => {
    await renderApp({ hash: '#/messages/c_zhouke', width: 390, setup: seed });
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: '问我的 Plasticine' }));
    expect(await screen.findByRole('complementary', { name: '对话框' })).toBeTruthy();
  });
});

describe('bell icon and inbox page are removed', () => {
  it.each(['#/today', '#/tasks', '#/feed', '#/messages'])('%s 的页头没有铃', async (hash) => {
    await renderApp({ hash, setup: seed });
    await settle();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /站内信/ })).toBeNull();
    expect(document.querySelector('.page-head-bell')).toBeNull();
  });

  it('legacy #/inbox links redirect to messages', async () => {
    await renderApp({ hash: '#/inbox/inbox_aliyun_expire', setup: seed });
    await settle();
    expect(await screen.findByRole('complementary', { name: '消息' })).toBeTruthy();
  });
});
