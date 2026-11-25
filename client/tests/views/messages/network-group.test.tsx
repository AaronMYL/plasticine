import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedNetworkScene } from '../../../src/api/fake/network-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function alex(fake: FakeApi): void {
  seedNetworkScene({ contacts: fake.control.contacts, network: fake.control.network }, NOW, 'alex');
}

function xiaolin(fake: FakeApi): void {
  seedNetworkScene({ contacts: fake.control.contacts, network: fake.control.network }, NOW, 'xiaolin');
}

async function open(hash: string, setup: (fake: FakeApi) => void = alex,
): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ hash, width: 1440, setup });
  await settle();
  return app;
}

function list(): HTMLElement {
  return screen.getByRole('complementary', { name: '消息' });
}

function chat(name: string): HTMLElement {
  return screen.getByRole('log', { name: `和${name}的聊天记录` });
}

describe('Group chat', () => {
  it('lists groups in All and Groups tabs with mosaic avatar and speaker-prefixed preview', async () => {
    await open('#/messages');
    fireEvent.click(within(list()).getByRole('button', { name: '群组' }));
    const row = await within(list()).findByRole('button', { name: /^杭州周末/ });
    expect(row.querySelector('.group-avatar')?.getAttribute('data-grid')).toBe('2');
    expect(row.textContent).toContain('周可：');
  });

  it('labels peer messages with names, shows Alex\'s Plasticine on @, and claims group task card', async () => {
    const app = await open('#/messages/grp-hangzhou');
    const log = await waitFor(() => chat('杭州周末'));
    expect(within(log).getAllByText('小林').length).toBeGreaterThan(0);
    const asked = await within(log).findByText(/上次你们去的那家茶馆叫什么/);
    expect(asked.textContent).toContain('Alex 的 Plasticine');
    const card = within(log).getByRole('article', { name: '任务：周六中午帮忙订一桌川菜，6 个人，老人能吃的' });
    expect(within(card).getByText('全群 · 谁先接谁做')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '我来接' }));
    await waitFor(() => expect(app.control.contacts.groupChats.task('gt_lunch').state).toBe('claimed'));
  });

  it('Send task dropdown offers anyone-can-claim and each member, sending when assigned to Xiaolin', async () => {
    const app = await open('#/messages/grp-hangzhou');
    fireEvent.click(await screen.findByRole('button', { name: '发任务' }));
    const panel = screen.getByRole('region', { name: '发任务' });
    fireEvent.click(within(panel).getByRole('button', { name: /^发给/ }));
    const options = within(panel).getAllByRole('option').map((option) => option.textContent);
    expect(options).toHaveLength(4);
    expect(options[0]).toContain('全群 · 谁先接谁做');
    expect(options.slice(1).map((text) => text?.slice(1))).toEqual(['小林', '周可', '阿杰']);
    fireEvent.click(within(panel).getByRole('option', { name: /小林/ }));
    fireEvent.change(within(panel).getByRole('textbox', { name: '要做到什么' }), { target: { value: '买两箱水' } });
    fireEvent.click(within(panel).getByRole('button', { name: '发出' }));
    await waitFor(() => expect([...app.control.contacts.groupChats.tasks.values()]
      .some((task) => task.title === '买两箱水' && task.assignee?.name === '小林')).toBe(true));
  });

  it('group menu Leave requires confirmation explaining consequences', async () => {
    const app = await open('#/messages/grp-hangzhou');
    fireEvent.click(await screen.findByRole('button', { name: '群设置' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '退出群' }));
    const confirm = screen.getByRole('alertdialog', { name: '退出「杭州周末」？' });
    expect(confirm.textContent).toContain('收不到这个群的消息');
    fireEvent.click(within(confirm).getByRole('button', { name: '退出' }));
    await waitFor(() => expect(app.control.contacts.groupChats.record('grp-hangzhou').left).toBe(true));
  });

  it('New group selects 3 friends, creates group, and opens it', async () => {
    await open('#/messages/new-group');
    const pane = await screen.findByRole('region', { name: '新建群聊' });
    const boxes = within(pane).getAllByRole('checkbox');
    boxes.slice(0, 3).forEach((box) => fireEvent.click(box));
    expect(within(pane).getByText('已选 3')).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: '建群' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/messages\/grp-/));
  });
});

describe('Add friend, invite, new requests, and drafted task cards', () => {
  it('Invite friend gives 3 copyable lines with download link and @handle without invite codes', async () => {
    await open('#/messages/invite');
    const pane = await screen.findByRole('region', { name: '邀请朋友加入网络' });
    expect(await within(pane).findByText(/我在用 Plasticine，邀请你加入/)).toBeTruthy();
    expect(within(pane).getByText(/装好后加我 @alex/)).toBeTruthy();
    expect(within(pane).queryByText(/邀请码/)).toBeNull();
    expect(within(pane).queryByRole('button', { name: '换一个码' })).toBeNull();
    expect(within(pane).getByRole('button', { name: '复制这段话' })).toBeTruthy();
  });

  it('new request card has relationship selector and records chosen relationship on accept', async () => {
    const app = await open('#/messages/requests', xiaolin);
    const pane = await screen.findByRole('region', { name: '新请求' });
    fireEvent.click(await within(pane).findByRole('button', { name: '合作方' }));
    fireEvent.click(within(pane).getByRole('button', { name: '接受' }));
    await waitFor(() => expect(app.control.contacts.people.get('c_alex2')?.relation).toBe('partner'));
  });

  it('Add friend page previews account looked up by handle and shows scannable QR code', async () => {
    await open('#/messages/add');
    const pane = await screen.findByRole('region', { name: '加好友' });
    fireEvent.change(within(pane).getByRole('textbox', { name: '账号号或链接' }), { target: { value: 'xiaolin' } });
    expect(await within(pane).findByText('@xiaolin', {}, { timeout: 2000 })).toBeTruthy();
    expect(within(pane).getByRole('img', { name: /^二维码/ })).toBeTruthy();
  });
});
