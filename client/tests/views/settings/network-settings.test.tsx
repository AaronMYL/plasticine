// 设置的六段（11-13 Aaron 看过设计稿定的重排）和其中两块：对外可见（隐私与授权里；只列放开的，三栏各自「添加」，
// 建议是虚线框的小片）。「邀请朋友」11-13 去掉（入网早就不要邀请码了）；「通知记录」11-14 去掉（旧链接落到「通知」）。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/errors.ts';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, m5b, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
}

function pane(): HTMLElement {
  return screen.getByRole('dialog', { name: '设置' });
}

describe('设置 · 分段', () => {
  it('六段：通用 · 账号 · AI · 隐私与授权 · 浏览器 · 系统；账号里只有名字和密码、在别的设备上用、登录着的设备', async () => {
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
    expect(within(pane()).getByRole('region', { name: '对外授权' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: '通用' }));
    expect(await within(pane()).findByRole('heading', { level: 3, name: '通知' })).toBeTruthy();
    expect(within(pane()).queryByRole('heading', { level: 3, name: '通知记录' })).toBeNull();
  });
});

describe('设置 · 账号：没有邀请朋友这一段了', () => {
  it('加入了也不出邀请码；和中继同步出的错写在名字那一块', async () => {
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

describe('设置 · 对外可见', () => {
  it('旧地址 #/settings/visibility 进到「隐私与授权」；三栏写谁能问到；没放开的不列，只在最下面写一共多少样私密', async () => {
    await renderApp({ hash: '#/settings/visibility', setup: seed });
    expect(await within(pane()).findByRole('heading', { level: 2, name: '隐私与授权' })).toBeTruthy();
    const friend = await within(pane()).findByRole('region', { name: /^朋友：.*朋友能问到$/ });
    expect(within(pane()).getByRole('region', { name: /^合作：.*合作方和朋友能问到$/ })).toBeTruthy();
    expect(within(pane()).getByRole('region', { name: '公开：所有人能问到' })).toBeTruthy();
    // 「关于你」是私密：不在任何一栏里。
    expect(within(pane()).queryByText('关于你')).toBeNull();
    expect(within(pane()).getByText(/^其余 \d+ 样都是私密：/)).toBeTruthy();
    expect(within(friend).getByText('阅读兴趣').closest('.vis-chip')?.getAttribute('data-pending')).toBe('true');
  });

  it('建议是虚线框的小片：√ 同意就放进这一栏，× 不要就不再列；「都同意」一次确认完', async () => {
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

  it('「都不要」：建议都清掉，哪一栏都不多东西', async () => {
    const app = await renderApp({ hash: '#/settings/visibility', setup: seed });
    fireEvent.click(await within(pane()).findByRole('button', { name: '都不要' }));
    await waitFor(async () => expect((await app.api.visibility.get()).pending).toBe(0));
    await waitFor(() => expect(within(pane()).queryByText(/建议再放开/)).toBeNull());
    expect(within(pane()).queryByText('阅读兴趣')).toBeNull();
  });

  it('添加：点开找一样私密的放进这一栏；点 × 收回成私密', async () => {
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

describe('设置 · 通知（11-14 去掉「通知记录」）', () => {
  it('旧的「通知记录」链接落到通用里的「通知」，那一块不在了', async () => {
    await renderApp({ hash: '#/settings/notices', setup: seed });
    expect(await within(pane()).findByRole('heading', { level: 3, name: '通知' })).toBeTruthy();
    expect(within(pane()).queryByRole('heading', { level: 3, name: '通知记录' })).toBeNull();
  });
});
