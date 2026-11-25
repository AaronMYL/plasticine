import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, toolGroups, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: toolGroups.inbox, network, visibility }, NOW);
}

function pane(): HTMLElement {
  return screen.getByRole('dialog', { name: '设置' });
}

describe('Settings - Sections', () => {
  it('shows 6 sections (General, Account, AI, Privacy, Browser, System) and trimmed Account content', async () => {
    await renderApp({ hash: '#/settings', setup: seed });
    const nav = await within(await screen.findByRole('dialog', { name: '设置' }))
      .findByRole('navigation', { name: '设置分类' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['通用', '账号', 'AI', '隐私与授权', '浏览器', '系统']);
    fireEvent.click(within(nav).getByRole('button', { name: '账号' }));
    await within(pane()).findByRole('region', { name: '名字和密码' });
    expect(within(pane()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['在别的设备上用', '登录着的设备']);
    expect(within(pane()).getByRole('button', { name: '换头像' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: '隐私与授权' }));
    expect(await within(pane()).findByRole('heading', { level: 3, name: '对外可见' })).toBeTruthy();
    const granted = within(pane()).getByRole('region', { name: '已经授权的' });
    expect(within(granted).getByRole('link', { name: '对外发送、以后直接做的：在记忆 · 承诺和授权' })
      .getAttribute('href')).toBe('#/memory/topics/memdoc-grants');
    fireEvent.click(within(nav).getByRole('button', { name: '通用' }));
    expect(await within(pane()).findByRole('heading', { level: 3, name: '通知' })).toBeTruthy();
    expect(within(pane()).queryByRole('heading', { level: 3, name: '通知记录' })).toBeNull();
  });
});

describe('Settings - Account no longer has Invite friends section', () => {
  it('omits invite code after joining and displays relay sync error under name block', async () => {
    await renderApp({ hash: '#/settings/network', setup: (fake) => {
      seed(fake);
      fake.control.network.fail('中继连不上，稍后会再试。');
    } });
    const profile = await within(pane()).findByRole('region', { name: '名字和密码' });
    expect(await within(profile).findByText('中继连不上，稍后会再试。')).toBeTruthy();
    expect(within(pane()).queryByRole('button', { name: '邀请朋友' })).toBeNull();
    expect(within(pane()).queryByRole('list', { name: '发过的邀请码' })).toBeNull();
    expect(within(pane()).queryByRole('form', { name: '加入网络' })).toBeNull();
  });
});

describe('Settings - External visibility', () => {
  it('legacy #/settings/visibility opens Privacy with 3 columns and bottom count of private items', async () => {
    await renderApp({ hash: '#/settings/visibility', setup: seed });
    expect(await within(pane()).findByRole('heading', { level: 2, name: '隐私与授权' })).toBeTruthy();
    const friend = await within(pane()).findByRole('region', { name: /^朋友：.*朋友能问到$/ });
    expect(within(pane()).getByRole('region', { name: /^合作：.*合作方和朋友能问到$/ })).toBeTruthy();
    expect(within(pane()).getByRole('region', { name: '公开：所有人能问到' })).toBeTruthy();
    expect(within(pane()).queryByText('关于你')).toBeNull();
    expect(within(pane()).getByText(/^其余 \d+ 样都是私密：/)).toBeTruthy();
    expect(within(friend).getByText('阅读兴趣').closest('.vis-chip')?.getAttribute('data-pending')).toBe('true');
  });

  it('dashed suggestion chips approve into column, dismiss cleanly, or batch-approve via Approve all', async () => {
    const app = await renderApp({ hash: '#/settings/visibility', setup: seed });
    expect(await within(pane()).findByText('Plasticine 建议再放开 3 样（虚线框的）')).toBeTruthy();
    fireEvent.click(within(pane()).getByRole('button', { name: '同意把「阅读兴趣」放到朋友' }));
    await waitFor(() => expect(within(pane()).getByText('阅读兴趣').closest('.vis-chip')
      ?.hasAttribute('data-pending')).toBe(false));
    expect(within(pane()).getByText('Plasticine 建议再放开 2 样（虚线框的）')).toBeTruthy();
    fireEvent.click(within(pane()).getByRole('button', { name: '都同意' }));
    await waitFor(() => expect(within(pane()).queryByText(/建议再放开/)).toBeNull());
    expect((await app.api.visibility.get()).pending).toBe(0);
    expect(pane().querySelector('.vis-chip[data-pending]')).toBeNull();
  });

  it('Dismiss all clears suggestions without adding items to any column', async () => {
    const app = await renderApp({ hash: '#/settings/visibility', setup: seed });
    fireEvent.click(await within(pane()).findByRole('button', { name: '都不要' }));
    await waitFor(async () => expect((await app.api.visibility.get()).pending).toBe(0));
    await waitFor(() => expect(within(pane()).queryByText(/建议再放开/)).toBeNull());
    expect(within(pane()).queryByText('阅读兴趣')).toBeNull();
  });

  it('Add moves a private item into column and x revokes it back to private', async () => {
    const app = await renderApp({ hash: '#/settings/visibility', setup: seed });
    const friend = await within(pane()).findByRole('region', { name: /^朋友：/ });
    fireEvent.click(within(friend).getByRole('button', { name: '添加到朋友' }));
    const picker = await screen.findByRole('dialog', { name: '放到朋友' });
    fireEvent.change(within(picker).getByRole('searchbox', { name: '找记忆、项目、笔记、空间' }),
      { target: { value: '关于' } });
    fireEvent.click(within(picker).getByRole('button', { name: /关于你/ }));
    expect(await within(friend).findByText('关于你')).toBeTruthy();
    const marked = async (): Promise<string | undefined> => (await app.api.visibility.get()).materials
      .find((row) => row.title === '关于你')?.tier;
    await waitFor(async () => expect(await marked()).toBe('friend'));
    fireEvent.click(within(friend).getByRole('button', { name: '收回「关于你」，改回私密' }));
    await waitFor(async () => expect(await marked()).toBe('private'));
    await waitFor(() => expect(within(friend).queryByText('关于你')).toBeNull());
  });
});

describe('Settings - Notifications (removed Notification log)', () => {
  it('legacy notification log route lands on General -> Notifications without removed block', async () => {
    await renderApp({ hash: '#/settings/notices', setup: seed });
    expect(await within(pane()).findByRole('heading', { level: 3, name: '通知' })).toBeTruthy();
    expect(within(pane()).queryByRole('heading', { level: 3, name: '通知记录' })).toBeNull();
  });
});
