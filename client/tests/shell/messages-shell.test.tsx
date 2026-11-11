// 手机（11-07 定）：底栏 现在 · Plasticine · 消息 · 笔记 · 更多；有事等他时「更多」和抽屉里的「任务」带一个陶土点。
// 手机上消息是一整页列表（分段控件撑满，底栏照上，右下有圆球）→ 点一条是一整页（底栏收起、不画圆球）→ 资料整页，各有
// 返回；Plasticine 是底栏的一格，顶上「主线 ⌄」切到旁聊。铃和站内信页去掉了，旧链接 #/inbox… 到消息。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, m5b, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
}

function waitingSeed(fake: FakeApi): void {
  seed(fake);
  fake.control.asks.raise({ id: 'ask_wait', kind: 'decide', question: '首页卡片按类别还是按项目上色？',
    options: [{ id: 'a', label: '按类别', recommended: true, description: null }] });
}

function phoneBar(): HTMLElement | null {
  return document.querySelector('.phone-bar');
}

describe('手机 · 底栏与消息的几页', () => {
  it('底栏是 首页 · Plasticine · 消息 · 笔记 · 更多；「更多」是底部抽屉：任务、阅读、资料库和设置', async () => {
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

  it('有事等他时「更多」和抽屉里的「任务」带一个陶土点，别的格没有', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: waitingSeed });
    await settle();
    const bar = (): HTMLElement => screen.getByRole('navigation', { name: '主导航' });
    await waitFor(() => expect(within(bar()).getByRole('button', { name: '更多 · 有等你的事' })).toBeTruthy());
    expect(bar().querySelectorAll('.phone-tab-dot')).toHaveLength(1);
    fireEvent.click(within(bar()).getByRole('button', { name: '更多 · 有等你的事' }));
    const drawer = await screen.findByRole('dialog', { name: '更多' });
    expect(within(drawer).getByRole('button', { name: '任务 · 有等你的事' })).toBeTruthy();
  });

  it('列表（分段控件、底栏、圆球）→ 和人的聊天整页（底栏收起、没有圆球）→ 资料整页，返回一步步回来', async () => {
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

  it('Plasticine 手机入口是队友名单，点击主线后全屏聊天', async () => {
    await renderApp({ hash: '#/today', width: 390, setup: seed });
    await settle();
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' }))
      .getByRole('button', { name: 'Plasticine' }));
    await waitFor(() => expect(window.location.hash).toBe('#/plasticine'));
    expect(screen.queryByRole('textbox', { name: '问一句' })).toBeNull();
    expect(phoneBar()).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Plasticine 主线' }));
    expect(await screen.findByRole('textbox', { name: '问一句' })).toBeTruthy();
    expect(phoneBar()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回队友列表' }));
    expect(await screen.findByRole('link', { name: '记忆' })).toBeTruthy();
  });

  it('聊天页顶上的 ✦ 打开对话（问我的 Plasticine）', async () => {
    await renderApp({ hash: '#/messages/c_zhouke', width: 390, setup: seed });
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: '问我的 Plasticine' }));
    expect(await screen.findByRole('complementary', { name: '对话框' })).toBeTruthy();
  });
});

describe('铃和站内信页去掉了', () => {
  it.each(['#/today', '#/tasks', '#/feed', '#/messages'])('%s 的页头没有铃', async (hash) => {
    await renderApp({ hash, setup: seed });
    await settle();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /站内信/ })).toBeNull();
    expect(document.querySelector('.page-head-bell')).toBeNull();
  });

  it('旧链接 #/inbox… 到消息', async () => {
    await renderApp({ hash: '#/inbox/inbox_aliyun_expire', setup: seed });
    await settle();
    expect(await screen.findByRole('complementary', { name: '消息' })).toBeTruthy();
  });
});
