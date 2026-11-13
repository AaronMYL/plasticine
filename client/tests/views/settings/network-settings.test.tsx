// 设置 · 账号里的两段（第 113 条）：对外可见（三类联系人的台阶、每条材料四个单选、建议是橙色空心圈、「n 处等你确认」+
// 「全部确认」）、通知记录（原 Plasticine 通知）。「邀请朋友」那一段 11-13 Aaron 定去掉（入网早就不要邀请码了）。

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
  it('六段：通用 · AI · 浏览器 · 账号 · 授权 · 系统；账号里是名字和密码、在别的设备上用、登录着的设备、头像、对外可见、通知记录',
    async () => {
    await renderApp({ hash: '#/settings', setup: seed });
    const nav = await within(await screen.findByRole('dialog', { name: '设置' }))
      .findByRole('navigation', { name: '设置分类' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['通用', 'AI', '浏览器', '账号', '授权', '系统']);
    fireEvent.click(within(nav).getByRole('button', { name: '账号' }));
    const titles = within(pane()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles.slice(0, 5)).toEqual(['在别的设备上用', '登录着的设备', '头像', '对外可见', '通知记录']);
    expect(within(pane()).queryByRole('heading', { name: '邀请朋友' })).toBeNull();
    expect(within(pane()).getByRole('region', { name: '名字和密码' })).toBeTruthy();
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
  it('上半三类联系人的台阶；下半按组每条四个单选；建议是等你确认的圈；全部确认后没有建议了', async () => {
    const app = await renderApp({ hash: '#/settings/visibility', setup: seed });
    expect(await within(pane()).findByText('3 处等你确认')).toBeTruthy();
    expect(within(pane()).getByRole('group', { name: '合作方能听到：公开、合作' })).toBeTruthy();
    const memory = within(pane()).getByRole('group', { name: '记忆' });
    const reading = within(memory).getByRole('radiogroup', { name: '阅读兴趣' });
    expect(within(reading).getAllByRole('radio')).toHaveLength(4);
    const suggested = within(reading).getByRole('radio', { name: '阅读兴趣：朋友，Plasticine 建议，等你确认' });
    expect(suggested.getAttribute('data-state')).toBe('ask');
    expect(within(reading).queryByRole('radio', { checked: true })).toBeNull();
    const about = within(memory).getByRole('radiogroup', { name: '关于你' });
    expect(within(about).getByRole('radio', { name: '关于你：私密' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(pane()).getByRole('button', { name: '全部确认' }));
    await waitFor(() => expect(within(pane()).queryByText(/处等你确认/)).toBeNull());
    expect(within(reading).getByRole('radio', { name: '阅读兴趣：朋友' }).getAttribute('aria-checked')).toBe('true');
    expect((await app.api.visibility.get()).pending).toBe(0);
  });

  it('点一档就是你定的：那一格选中，建议清掉', async () => {
    await renderApp({ hash: '#/settings/visibility', setup: seed });
    const project = await within(pane()).findByRole('radiogroup', { name: 'Cyber Hunter' });
    fireEvent.click(within(project).getByRole('radio', { name: 'Cyber Hunter：合作' }));
    await waitFor(() => expect(within(project).getByRole('radio', { name: 'Cyber Hunter：合作' })
      .getAttribute('aria-checked')).toBe('true'));
    expect(within(project).queryByRole('radio', { name: /等你确认/ })).toBeNull();
    expect(within(pane()).getByText('2 处等你确认')).toBeTruthy();
  });
});

describe('设置 · 通知记录', () => {
  it('列出 Plasticine 自己的通知（邮件不在这里）；没读的标一个点，点开看全文并标成读过', async () => {
    const app = await renderApp({ hash: '#/settings/notices', setup: seed });
    const notices = await within(pane()).findByRole('list', { name: '通知' });
    expect(within(notices).getAllByRole('listitem')).toHaveLength(2);
    expect(within(notices).queryByText(/实例将于/)).toBeNull();
    const backup = within(notices).getByRole('button', { name: /本机备份做好了/ });
    expect(within(backup).getByRole('img', { name: '没读' })).toBeTruthy();
    fireEvent.click(backup);
    expect(await within(notices).findByText(/可以在「设置 · 系统」里按对象恢复/)).toBeTruthy();
    await waitFor(() => expect(app.control.m5b.inbox.find('inbox_notice_backup')?.read).toBe(true));
    await settle();
  });

  it('通知记录读失败：说原因并给「再读一次」，不显示成空（原站内信浮层的同一条，第 113 条挪到这里）', async () => {
    const failing = { on: true };
    await renderApp({ hash: '#/settings/notices', setup: (fake) => {
      seed(fake);
      const list = fake.api.inbox.list.bind(fake.api.inbox);
      vi.spyOn(fake.api.inbox, 'list').mockImplementation(async (...args) => {
        if (failing.on) {
          throw new ApiError({ kind: 'failed', code: 'internal_error', message: '服务暂时不可用。', status: 503 });
        }
        return list(...args);
      });
    } });
    const alert = await within(pane()).findByRole('alert');
    expect(within(pane()).queryByText('还没有通知')).toBeNull();
    failing.on = false;
    fireEvent.click(within(alert).getByRole('button', { name: '再读一次' }));
    expect(await within(pane()).findByRole('list', { name: '通知' })).toBeTruthy();
  });
});
