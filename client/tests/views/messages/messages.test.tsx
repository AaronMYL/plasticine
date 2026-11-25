import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, toolGroups, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: toolGroups.inbox, network, visibility }, NOW);
}

async function open(hash: string, width = 1440): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ hash, width, setup: seed });
  await settle();
  return app;
}

function list(): HTMLElement {
  return screen.getByRole('complementary', { name: '消息' });
}

function rowNames(filter = '联系人'): string[] {
  return within(within(list()).getByRole('list', { name: filter })).getAllByRole('button')
    .filter((button) => button.classList.contains('contact-row'))
    .map((button) => button.getAttribute('aria-label')?.split('，')[0] ?? '');
}

function filterButton(name: RegExp | string): HTMLElement {
  return within(within(list()).getByRole('group', { name: '筛选' })).getByRole('button', { name });
}

function chat(name: string): HTMLElement {
  return screen.getByRole('log', { name: `和${name}的聊天记录` });
}

describe('Messages - List', () => {
  it('defaults to Contacts with request count row, initial avatars, waiting dot, and no Plasticine', async () => {
    await open('#/messages');
    await waitFor(() => expect(rowNames().slice(0, 4)).toEqual(['林一', '周可', '陈默', '阿杰']));
    expect(within(list()).queryByRole('button', { name: 'Plasticine' })).toBeNull();
    expect(within(list()).getByRole('button', { name: '新请求 1' })).toBeTruthy();
    expect(filterButton('联系人').getAttribute('aria-pressed')).toBe('true');
    const lin = within(list()).getByRole('button', { name: '林一' });
    expect(lin.querySelector('.contact-avatar')?.textContent).toBe('林');
    const zhou = within(list()).getByRole('button', { name: '周可，等你' });
    expect(within(zhou).getByText('等你')).toBeTruthy();
    expect(within(lin).getByRole('img', { name: '林一的 Plasticine' })).toBeTruthy();
    expect(await screen.findByRole('log', { name: '和林一的聊天记录' })).toBeTruthy();
  });

  it('filters Contacts/Groups/Email/All without AI suggestions and divides people from email in All', async () => {
    await open('#/messages');
    expect(within(within(list()).getByRole('group', { name: '筛选' })).getAllByRole('button')
      .map((button) => button.textContent)).toEqual(['联系人', '群组', '邮件', '全部']);
    fireEvent.click(filterButton('邮件'));
    expect(rowNames('邮件')).toEqual(['阿里云']);
    const mail = within(list()).getByRole('button', { name: '阿里云，1 条没读' });
    expect(mail.querySelector('.contact-avatar-square')).not.toBeNull();
    expect(mail.querySelector('.contact-unread')?.textContent).toBe('1');
    fireEvent.click(filterButton('联系人'));
    expect(rowNames('联系人')).toEqual(['林一', '周可', '陈默', '阿杰']);
    fireEvent.click(filterButton('全部'));
    expect(rowNames('全部')).toContain('巡查');
    const starts = [...list().querySelectorAll('.contact-row-item[data-group-start="true"]')];
    expect(starts.map((item) => item.querySelector('.contact-row-name')?.textContent)).toEqual(['阿里云']);
  });

  it('switching chat keeps list mounted and preserves scroll position', async () => {
    await open('#/messages/c_linyi');
    const before = list();
    before.scrollTop = 80;
    fireEvent.click(within(before).getByRole('button', { name: '周可，等你' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_zhouke'));
    expect(list()).toBe(before);
    expect(list().scrollTop).toBe(80);
    expect(within(list()).getByRole('button', { name: '周可，等你' }).getAttribute('aria-current')).toBe('true');
  });

  it('accepting new request opens chat with contact and removes pinned request row', async () => {
    const app = await open('#/messages');
    fireEvent.click(await within(list()).findByRole('button', { name: '新请求 1' }));
    expect(window.location.hash).toBe('#/messages/requests');
    const request = await screen.findByRole('listitem', { name: '小满' });
    expect(within(request).getByText(/想请你的 Plasticine 帮忙看一份简历/)).toBeTruthy();
    fireEvent.click(within(request).getByRole('button', { name: '接受' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_xiaoman'));
    await waitFor(() => expect(within(list()).queryByRole('button', { name: /^新请求/ })).toBeNull());
    expect(app.control.contacts.people.get('c_xiaoman')?.state).toBe('active');
  });

  it('Add friend via + menu looks up handle, explains missing account, and opens chat once added', async () => {
    await open('#/messages');
    fireEvent.click(within(list()).getByRole('button', { name: '加人、建群、邀请' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '加好友' }));
    const pane = await screen.findByRole('region', { name: '加好友' });
    fireEvent.change(within(pane).getByRole('textbox', { name: '账号号或链接' }), { target: { value: 'nobody' } });
    fireEvent.click(within(pane).getByRole('button', { name: '加好友' }));
    expect(await within(pane).findByText(/网络上没有 @nobody/)).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: '知道了' }));
    fireEvent.change(within(pane).getByRole('textbox', { name: '账号号或链接' }), { target: { value: '@yuanye' } });
    fireEvent.click(within(pane).getByRole('button', { name: '加好友' }));
    await waitFor(() => expect(window.location.hash).toBe('#/messages/c_yuanye'));
  });
});

describe('Messages - One-on-one chat', () => {
  it('contact left and self right with bubbles; AI has star no bubble; AI-to-AI collapses in center', async () => {
    await open('#/messages/c_linyi');
    const log = await waitFor(() => chat('林一'));
    const them = await within(log).findByText(/下周要给品牌方交 10 场直播的复盘/);
    expect(them.closest('.cm-line')?.getAttribute('data-side')).toBe('them');
    expect(them.classList.contains('cm-bubble')).toBe(true);
    const mine = within(log).getByText('可以，我发一条任务给你。');
    expect(mine.closest('.cm-line')?.getAttribute('data-side')).toBe('me');
    const theirAi = within(log).getByText('样例收到了，周四晚上交第一版。');
    expect(theirAi.classList.contains('cm-bubble')).toBe(false);
    expect(within(theirAi.closest('.cm-line') as HTMLElement).getByRole('img', { name: '林一的 Plasticine' }))
      .toBeTruthy();
    const fold = within(log).getByRole('button', { name: /对齐了表格格式和退货口径，两边的 Plasticine 说了 6 句/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(within(log).queryByText('按签收，退货率另起一列。')).toBeNull();
    fireEvent.click(fold);
    const body = within(log).getByRole('group', { name: '两边的 Plasticine 说的' });
    expect(within(body).getByText('按签收，退货率另起一列。').closest('.cm-line')?.getAttribute('data-side'))
      .toBe('me');
    expect(within(body).getAllByRole('img', { name: '你的 Plasticine' })).toHaveLength(3);
  });

  it('incoming SSE message appends to open chat and moves contact to top of list', async () => {
    const app = await open('#/messages/c_zhouke');
    await within(chat('周可')).findByText(/想整理成要点/);
    act(() => {
      app.control.contacts.post('c_zhouke', app.control.contacts.message('c_zhouke', 'them', '还在吗？'));
    });
    const line = await within(chat('周可')).findByText('还在吗？');
    expect(line.closest('.cm-line')?.getAttribute('data-side')).toBe('them');
    await waitFor(() => expect(rowNames()[0]).toBe('周可'));
  });

  it('chat header has name and 3 icons (task, search, profile); search filters matching messages', async () => {
    await open('#/messages/c_linyi');
    const main = screen.getByRole('region', { name: '和林一的聊天' });
    const head = main.querySelector('.ct-head') as HTMLElement;
    expect(within(head).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['发任务', '在这段聊天里找', '关掉林一的资料']);
    fireEvent.click(within(head).getByRole('button', { name: '在这段聊天里找' }));
    fireEvent.change(within(main).getByRole('searchbox', { name: '在这段聊天里找' }), { target: { value: '复盘表' } });
    const log = chat('林一');
    expect(within(log).getByRole('article', { name: /任务：把 10 场直播的商单整理成复盘表/ })).toBeTruthy();
    expect(within(log).queryByText('可以，我发一条任务给你。')).toBeNull();
  });

  it('Enter sends message on right (see compose-predict.test.tsx for inline ghost suggestions)', async () => {
    await open('#/messages/c_linyi');
    const input = await screen.findByRole('textbox', { name: '发给林一' }) as HTMLTextAreaElement;
    expect(input.placeholder).toBe('发给林一');
    fireEvent.change(input, { target: { value: '好，周四晚上我看第一版' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const sent = await within(chat('林一')).findByText('好，周四晚上我看第一版');
    expect(sent.closest('.cm-line')?.getAttribute('data-side')).toBe('me');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('mentioning contact AI sends target ai and prefixes my bubble with @star contact\'s Plasticine', async () => {
    const app = await open('#/messages/c_linyi');
    const input = await screen.findByRole('textbox', { name: '发给林一' });
    fireEvent.change(input, { target: { value: '@' } });
    const menu = await screen.findByRole('listbox', { name: '@ 联系人' });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['林林一', '林一的 Plasticine', '我的 Plasticine']);
    fireEvent.click(within(menu).getByRole('option', { name: /林一的 Plasticine/ }));
    const asking = screen.getByRole('textbox', { name: '问林一的 Plasticine' });
    fireEvent.change(asking, { target: { value: '林一周五有空吗' } });
    fireEvent.click(within(screen.getByRole('region', { name: '和林一的聊天' })).getByRole('button', { name: '发送' }));
    const bubble = await within(chat('林一')).findByText('林一周五有空吗');
    expect(bubble.textContent).toContain('林一的 Plasticine');
    const page = await app.api.contacts.messages('c_linyi', {});
    const message = page.items.flatMap((item) => (item.type === 'message' ? [item.message] : []))
      .find((candidate) => candidate.text === '林一周五有空吗');
    expect(message?.toAi).toBe(true);
  });

  it('system source (patrol) is read-only without input box and appears only in All', async () => {
    await open(`#/messages/${encodeURIComponent('system:patrol')}`);
    expect(await within(chat('巡查')).findByText(/首页头条可以换成「等你」的第一条/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '发给巡查' })).toBeNull();
    expect(filterButton('全部').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Messages - Email', () => {
  const ALIYUN = `#/messages/${encodeURIComponent('mail:noreply@aliyun.com')}`;

  it('clicking email opens reading pane with subject, sender, time, plain body, and earlier threads', async () => {
    await open(ALIYUN);
    const reader = await screen.findByRole('article', { name: /^实例将于 .* 到期$/ });
    expect(within(reader).getByRole('heading', { level: 2 }).textContent).toMatch(/^实例将于 .* 到期$/);
    const from = reader.querySelector('.mail-reader-from') as HTMLElement;
    expect(from.textContent).toContain('阿里云');
    expect(from.hasAttribute('data-tip')).toBe(false);
    expect(from.querySelector('.mail-reader-address')?.textContent).toBe('noreply@aliyun.com');
    expect(reader.querySelector('.cm-bubble')).toBeNull();
    const frame = await waitFor(() => within(reader).getByTitle(/^邮件正文：实例将于/));
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    const others = within(reader).getByRole('list', { name: '这个地址来的其他邮件' });
    fireEvent.click(within(others).getByRole('button', { name: /10 月账单已出/ }));
    expect(await within(reader).findByRole('heading', { name: '10 月账单已出' })).toBeTruthy();
    expect(await within(reader).findByText('您 10 月的账单已出，金额 ¥86.40。')).toBeTruthy();
    expect(within(list()).getByRole('button', { name: /^阿里云/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('complementary', { name: '阿里云的资料' })).toBeNull();
  });

  it('Open in Gmail searches by address and subject; menu Reply replies to latest email on Send', async () => {
    const app = await open(ALIYUN);
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const reader = await screen.findByRole('article', { name: /^实例将于/ });
    fireEvent.click(within(reader).getByRole('button', { name: '在 Gmail 打开' }));
    const url = String(opened.mock.calls[0]?.[0] ?? '');
    expect(url.startsWith('https://mail.google.com/mail/u/0/#search/')).toBe(true);
    expect(decodeURIComponent(url)).toContain('from:noreply@aliyun.com subject:"实例将于');
    opened.mockRestore();
    fireEvent.click(within(reader).getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '回复' }));
    const input = await within(reader).findByRole('textbox', { name: '发给阿里云' }) as HTMLTextAreaElement;
    expect(input.placeholder).toBe('回 阿里云');
    fireEvent.change(input, { target: { value: '已续费' } });
    expect(app.control.toolGroups.inbox.find('inbox_aliyun_expire')?.replies).toHaveLength(0);
    fireEvent.click(within(reader).getByRole('button', { name: '发送' }));
    await waitFor(() => expect(app.control.toolGroups.inbox.find('inbox_aliyun_expire')?.replies.at(-1)?.text)
      .toBe('已续费'));
  });
});

describe('Plasticine column', () => {
  it('hides compose overlay and orb, toggles search on click, and lists main, side chats, and memory', async () => {
    await open('#/plasticine');
    const column = screen.getByRole('complementary', { name: 'Plasticine' });
    expect(within(column).getByRole('link', { name: 'Plasticine 主线' }).getAttribute('aria-current')).toBe('page');
    expect(within(column).getByRole('link', { name: /^记忆/ })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: '主线' })).toBeTruthy();
    expect(within(main).getByRole('textbox', { name: '问一句' })).toBeTruthy();
    expect(within(main).queryByRole('button', { name: '问这一页' })).toBeNull();
    expect(within(main).queryByRole('button', { name: /切换对话/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^展开对话框/ })).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: '在记录里找' }));
    expect(within(main).getByRole('textbox', { name: '在记录里找' })).toBe(document.activeElement);
  });

  it('Add teammate opens standalone form; switching to Contacts still allows opening compose box', async () => {
    await open('#/plasticine');
    const column = screen.getByRole('complementary', { name: 'Plasticine' });
    fireEvent.click(within(column).getByRole('button', { name: '添加队友' }));
    expect(screen.getByRole('dialog', { name: '创建队友' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关掉创建队友' }));
    act(() => { window.location.hash = '#/messages/c_linyi'; });
    await waitFor(() => expect(screen.getByRole('complementary', { name: '对话框' })).toBeTruthy());
  });

});

describe('Messages - Task cards', () => {
  it('outgoing active task shows progress and detail without letting sender pause or accept for peer', async () => {
    await open('#/messages/c_linyi');
    const card = await within(chat('林一')).findByRole('article', { name: '任务：把 10 场直播的商单整理成复盘表' });
    expect(card.closest('.cm-line')?.getAttribute('data-side')).toBe('me');
    expect(within(card).getByRole('img', { name: '进度：发出 · 点头' })).toBeTruthy();
    expect(within(card).getByText(/林一的 Plasticine 在做/)).toBeTruthy();
    for (const name of ['暂停', '我来处理', '收到', '发回去', '撤回']) {
      expect(within(card).queryByRole('button', { name })).toBeNull();
    }
    fireEvent.click(within(card).getByRole('button', { name: '查看工作：把 10 场直播的商单整理成复盘表' }));
    const detail = await screen.findByRole('dialog', { name: '工作详情' });
    expect(await within(detail).findByText(/林一的 Plasticine 在做/)).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: '暂停' })).toBeNull();
  });

  it('pending task on peer side shows waiting dot; I\'ll do it submits delivery and awaits acceptance', async () => {
    await open('#/messages/c_zhouke');
    const card = await within(chat('周可')).findByRole('article', { name: '任务：整理 3 份访谈稿的要点' });
    expect(card.closest('.cm-line')?.getAttribute('data-side')).toBe('them');
    expect(within(card).getByRole('img', { name: '等你定' })).toBeTruthy();
    expect(within(card).getByText('把 3 份用户访谈稿的要点整理成一份')).toBeTruthy();
    for (const name of ['让 Plasticine 做', '我来做', '先不']) {
      expect(within(card).getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(within(card).getByRole('button', { name: '我来做' }));
    const deliver = await within(card).findByRole('textbox', { name: '交付「整理 3 份访谈稿的要点」' });
    expect(within(card).getByRole('img', { name: '等你交付' })).toBeTruthy();
    fireEvent.change(deliver, { target: { value: '10 条要点见附件' } });
    fireEvent.click(within(card).getByRole('button', { name: '交付' }));
    expect(await within(card).findByText(/交给周可了，等他收/)).toBeTruthy();
    expect(within(card).queryByRole('img', { name: /^等你/ })).toBeNull();
  });

  it('delivered task shows content with Accept and Revise; accepting moves it to delivery history', async () => {
    const app = await open('#/messages/c_linyi');
    const task = app.control.contacts.task('nt_lin_review');
    act(() => {
      app.control.contacts.putTask({ ...task, state: 'delivered', stage: 4, waiting: true, version: task.version + 1,
        delivery: { text: '第一版复盘表，退货率单独一列。', at: NOW.toISOString() } });
    });
    const card = await within(chat('林一')).findByRole('article', { name: '任务：把 10 场直播的商单整理成复盘表' });
    await within(card).findByText('第一版复盘表，退货率单独一列。');
    expect(within(card).getByRole('img', { name: '等你收' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '收到' }).className).toContain('primary-button');
    expect(within(card).getByRole('button', { name: '再改改' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '收到' }));
    expect(await within(card).findByText(/收到了/)).toBeTruthy();
    const profile = screen.getByRole('complementary', { name: '林一的资料' });
    await waitFor(() => expect(within(within(profile).getByRole('region', { name: '交付' }))
      .getByText('把 10 场直播的商单整理成复盘表').closest('li')?.textContent).not.toContain('在做'));
  });

  it('Send task popover sets assignee, due date, goal (first line as title), and files on my side', async () => {
    await open('#/messages/c_linyi');
    fireEvent.click(await screen.findByRole('button', { name: '发任务' }));
    const panel = screen.getByRole('region', { name: '发任务' });
    expect(within(panel).getByText('发出后林一会收到')).toBeTruthy();
    const submit = within(panel).getByRole('button', { name: '发出' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(panel).getByRole('textbox', { name: '要做到什么' }),
      { target: { value: '剪一版预告。30 秒，横屏' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('region', { name: '发任务' })).toBeNull());
    const card = await within(chat('林一')).findByRole('article', { name: '任务：剪一版预告' });
    expect(card.closest('.cm-line')?.getAttribute('data-side')).toBe('me');
    expect(within(card).getByText('等林一点头')).toBeTruthy();
  });
});

describe('Messages - Profile sidebar', () => {
  it('shows avatar, name, @handle, relationship control, deliveries, spoke-for-you, and safety code', async () => {
    const app = await open('#/messages/c_linyi');
    const profile = await screen.findByRole('complementary', { name: '林一的资料' });
    expect(within(profile).getByText('@linyi')).toBeTruthy();
    const relation = within(profile).getByRole('group', { name: '关系' });
    expect(within(relation).getByRole('button', { name: '合作方' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(relation).getByRole('button', { name: '朋友' }));
    await waitFor(() => expect(app.control.contacts.people.get('c_linyi')?.relation).toBe('friend'));
    await waitFor(() => expect(within(relation).getByRole('button', { name: '朋友' }).getAttribute('aria-pressed'))
      .toBe('true'));
    expect(await within(profile).findByRole('region', { name: '交付' })).toBeTruthy();
    expect(within(within(profile).getByRole('region', { name: '代你说过' })).getByText('周五下午有空')).toBeTruthy();
    fireEvent.click(within(profile).getByRole('button', { name: '核对安全码' }));
    expect(within(within(profile).getByRole('list', { name: '安全码' })).getAllByRole('listitem')).toHaveLength(12);
  });

  it('profile sidebar toggle persists open/closed state', async () => {
    const app = await open('#/messages/c_linyi');
    fireEvent.click(await screen.findByRole('button', { name: '关掉林一的资料' }));
    expect(screen.queryByRole('complementary', { name: '林一的资料' })).toBeNull();
    expect(app.state.shellPrefs.store.get().contactProfile).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '打开林一的资料' }));
    expect(await screen.findByRole('complementary', { name: '林一的资料' })).toBeTruthy();
    expect(app.state.shellPrefs.store.get().contactProfile).toBe(true);
  });

  it('prompts verification next to button when safety code changes', async () => {
    await renderApp({ hash: '#/messages/c_linyi', setup: (fake) => {
      seed(fake);
      const record = fake.control.contacts.people.get('c_linyi');
      if (record !== undefined) {
        record.safetyChanged = true;
      }
    } });
    const profile = await screen.findByRole('complementary', { name: '林一的资料' });
    expect(await within(profile).findByRole('alert')).toBeTruthy();
    expect(within(profile).getByText(/安全码变了/)).toBeTruthy();
  });
});

