// 设置的三段新内容（第 113 条）：邀请朋友（11-08 起 @账号在最上面的账号一行；还要邀请码的旧情形才出加入表单；加入了是
// 邀请朋友、发过的码）、对外可见（三类联系人的
// 台阶、每条材料四个单选、建议是橙色空心圈、「n 处等你确认」+「全部确认」）、通知记录（原 Plasticine 通知）。

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
  it('六段：通用 · AI · 浏览器 · 账号 · 授权 · 系统；账号里是名字和密码、登录着的设备、头像、邀请朋友、对外可见、通知记录',
    async () => {
    await renderApp({ hash: '#/settings', setup: seed });
    const nav = await within(await screen.findByRole('dialog', { name: '设置' }))
      .findByRole('navigation', { name: '设置分类' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['通用', 'AI', '浏览器', '账号', '授权', '系统']);
    fireEvent.click(within(nav).getByRole('button', { name: '账号' }));
    const titles = within(pane()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles.slice(0, 5)).toEqual(['登录着的设备', '头像', '邀请朋友', '对外可见', '通知记录']);
    expect(within(pane()).getByRole('region', { name: '名字和密码' })).toBeTruthy();
  });
});

describe('设置 · 邀请朋友', () => {
  it('没加入、不要邀请码：这一段不出现（在最上面的账号一行起 @账号）', async () => {
    await renderApp({ hash: '#/settings/network' });
    await within(pane()).findByRole('region', { name: '名字和密码' });
    expect(within(pane()).queryByRole('form', { name: '加入网络' })).toBeNull();
    expect(within(pane()).queryByRole('heading', { name: '邀请朋友' })).toBeNull();
  });

  it('中继上已经有人了：表单多一栏邀请码', async () => {
    await renderApp({ hash: '#/settings/network', setup: (fake) => {
      fake.control.network.relayEmpty = false;
    } });
    const form = await within(pane()).findByRole('form', { name: '加入网络' });
    expect(within(form).getByRole('textbox', { name: '邀请码' })).toBeTruthy();
  });

  it('加入了：邀请朋友生成一个码和一句能复制的话；发过的码列出来，用掉的写是谁', async () => {
    await renderApp({ hash: '#/settings/network', setup: seed });
    expect(await within(pane()).findByText(/@alex/)).toBeTruthy();
    const invites = await within(pane()).findByRole('list', { name: '发过的邀请码' });
    expect(within(invites).getByText('@linyi')).toBeTruthy();
    fireEvent.click(within(pane()).getByRole('button', { name: '邀请朋友' }));
    const fresh = await within(pane()).findByLabelText('刚生成的邀请码');
    const code = fresh.querySelector('.network-invite-code')?.textContent ?? '';
    expect(code).toMatch(/^CH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(within(fresh).getByText(new RegExp(`填邀请码 ${code}`))).toBeTruthy();
    expect(within(fresh).getByRole('button', { name: '复制这句话' })).toBeTruthy();
    await waitFor(() => expect(within(invites).getAllByRole('listitem')).toHaveLength(2));
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
