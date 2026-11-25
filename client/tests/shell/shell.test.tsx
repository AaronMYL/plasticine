import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { RAIL_GROUPS, SECTIONS } from '../../src/shell/sections.ts';
import { fakeScrollableLists, renderApp, sayInMain, setViewportWidth, settle, HOME_HEADING } from '../helpers.tsx';

beforeAll(() => {
  fakeScrollableLists();
});

function chatColumn(): HTMLElement {
  return screen.getByRole('complementary', { name: '对话框' });
}

function chatInput(): HTMLTextAreaElement {
  return within(chatColumn()).getByRole('textbox', { name: '问一句' });
}

function rail(): HTMLElement {
  return screen.getByRole('navigation', { name: '栏目' });
}

function navTo(label: string): void {
  fireEvent.click(within(rail()).getByRole('button', { name: new RegExp(`^${label}`) }));
}

const RAIL_LABELS = RAIL_GROUPS.flat().map((id) => SECTIONS[id].label);

describe('shell: two-tier sidebar', () => {
  it('icon rail has 3 spaced groups plus bottom search/new/avatar; home has no secondary column', async () => {
    await renderApp();
    const groups = [...rail().querySelectorAll('.rail-group')].map((group) => within(group as HTMLElement)
      .getAllByRole('button').map((button) => button.getAttribute('aria-label')));
    expect(groups).toEqual([['首页', 'Plasticine', '消息', '任务'], ['网页', '阅读'], ['笔记', '资料库']]);
    expect(within(rail()).getByRole('button', { name: '搜索和切换' })).toBeTruthy();
    expect(within(rail()).getByRole('button', { name: '新建…' })).toBeTruthy();
    expect(within(rail()).getByRole('button', { name: '设置 · 我' }).querySelector('.rail-avatar')?.textContent)
      .toBe('我');
    expect(within(rail()).getByRole('button', { name: '首页' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.column')).toBeNull();
  });

  it('switching section swaps secondary list and main pane and restores last visited item', async () => {
    await renderApp();
    navTo('任务');
    await settle();
    const column = (): HTMLElement => screen.getByRole('complementary', { name: '任务' });
    expect(within(column()).getByRole('link', { name: /^在做/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(column()).getByRole('link', { name: /^定时/ }));
    await settle();
    expect(window.location.hash).toBe('#/tasks/timed');
    navTo('笔记');
    await settle();
    expect(screen.getByRole('complementary', { name: '笔记' })).toBeTruthy();
    navTo('任务');
    await settle();
    expect(window.location.hash).toBe('#/tasks/timed');
    navTo('任务');
    await settle();
    expect(window.location.hash).toBe('#/tasks');
  });

  it('Plasticine pages use route history (Cmd+[/]) without opening web tabs', async () => {
    await renderApp();
    navTo('笔记');
    await settle();
    navTo('阅读');
    await settle();
    expect(window.location.hash).toBe('#/feed');
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    fireEvent.keyDown(window, { key: ']', metaKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#/feed'));
    expect(screen.queryByRole('list', { name: '标签' })).toBeNull();
  });

  it('settings opens as modal from avatar, includes System, and restores focus on close', async () => {
    await renderApp();
    navTo('任务');
    await settle();
    const account = within(rail()).getByRole('button', { name: /^设置/ });
    account.focus();
    fireEvent.click(account);
    await settle();
    const dialog = screen.getByRole('dialog', { name: '设置' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getAllByRole('button').filter((button) => button.closest('nav') !== null)
      .map((button) => button.textContent)).toEqual(['通用', '账号', 'AI', '隐私与授权', '浏览器', '系统']);
    expect(window.location.hash).toBe('#/settings');
    fireEvent.click(within(dialog).getByRole('button', { name: '系统' }));
    await settle();
    expect(window.location.hash).toBe('#/settings/system');
    expect(screen.getByRole('complementary', { name: '任务' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-scrim'));
    await settle();
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull();
    expect(window.location.hash).toBe('#/tasks');
    expect(document.activeElement).toBe(account);
  });

  it('legacy #/settings/<sec> and #/device open settings modal over tab and restore URL on close', async () => {
    await renderApp({ hash: '#/settings/notices' });
    await settle();
    let dialog = await screen.findByRole('dialog', { name: '设置' });
    expect(within(dialog).getByRole('button', { name: '通用' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings');
    fireEvent.keyDown(document, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull();
    expect(window.location.hash).toBe('#/today');
    act(() => { window.location.hash = '#/device'; });
    await settle();
    dialog = await screen.findByRole('dialog', { name: '设置' });
    expect(within(dialog).getByRole('button', { name: '系统' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings/system');
    expect(within(rail()).getByRole('button', { name: '首页' }).getAttribute('aria-current')).toBe('page');
  });

  it('navigating to another route while settings is open closes modal and opens target page', async () => {
    await renderApp({ hash: '#/settings/general' });
    await screen.findByRole('dialog', { name: '设置' });
    act(() => { window.location.hash = '#/projects'; });
    await settle();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull());
    expect(window.location.hash).toBe('#/projects');
  });

  it('Tasks shows terracotta dot and waiting count when pending; Home hides the count', async () => {
    await renderApp({ width: 1200, setup: (fake) => {
      fake.control.asks.raise({ id: 'ask_wait', kind: 'decide', question: '首页卡片按类别还是按项目上色？',
        options: [{ id: 'a', label: '按类别', recommended: true, description: null }] });
    } });
    await settle();
    await waitFor(() => expect(within(rail()).getByRole('button', { name: '任务 · 有等你的事' })).toBeTruthy());
    expect(rail().querySelectorAll('.rail-dot')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^展开对话框/ })).toBeTruthy();
    navTo('笔记');
    await settle();
    const ball = screen.getByRole('button', { name: '展开对话框：Plasticine，等你 1' });
    expect(ball.querySelector('.chat-ball-badge')?.textContent).toBe('等你 1');
  });
});

describe('shell: floating chat persists across all tabs', () => {
  it('switching tabs preserves floating chat scroll position, draft, and quote chips', async () => {
    const app = await renderApp({
      setup: (fake) => {
        for (let index = 0; index < 5; index += 1) {
          sayInMain(fake, 'user', `第 ${index} 条`);
        }
      },
    });
    const list = within(chatColumn()).getByLabelText('对话记录');
    list.scrollTop = 120;
    fireEvent.scroll(list);
    fireEvent.change(chatInput(), { target: { value: '写到一半' } });
    act(() => {
      app.state.conversationUi.addQuote({ id: 'q1', kind: 'note', sourceId: 'n1', label: '《摘记》', text: '一段' });
    });
    for (const label of ['任务', '笔记', '阅读', '资料库', '首页']) {
      navTo(label);
      await settle();
    }
    expect(within(chatColumn()).getByLabelText('对话记录').scrollTop).toBe(120);
    expect(chatInput().value).toBe('写到一半');
    expect(within(chatColumn()).getByLabelText('引用片').textContent).toContain('《摘记》');
  });

  it('each main pane view remembers its own scroll position', async () => {
    await renderApp();
    const main = screen.getByRole('main');
    main.scrollTop = 300;
    fireEvent.scroll(main);
    navTo('任务');
    await settle();
    expect(screen.getByRole('main').scrollTop).toBe(0);
    navTo('首页');
    await settle();
    expect(screen.getByRole('main').scrollTop).toBe(300);
  });

  it('minimizes to bottom-right bubble, restores scroll/draft on reopen, persists open state', async () => {
    const app = await renderApp();
    const list = within(chatColumn()).getByLabelText('对话记录');
    list.scrollTop = 80;
    fireEvent.scroll(list);
    fireEvent.change(chatInput(), { target: { value: '收起前的字' } });
    fireEvent.click(screen.getByRole('button', { name: '缩小对话框' }));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^展开对话框/ }));
    expect(chatInput().value).toBe('收起前的字');
    expect(within(chatColumn()).getByLabelText('对话记录').scrollTop).toBe(80);
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(true);
  });

  it('Plasticine section hides floating chat and bubble (including legacy #/conversation)', async () => {
    await renderApp({ hash: '#/conversation' });
    await waitFor(() => expect(window.location.hash).toBe('#/plasticine/main'));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.queryByRole('button', { name: /展开对话框/ })).toBeNull();
    expect(document.querySelector('[data-container="page"]')).not.toBeNull();
  });

  it('shrinking window collapses untouched floating chat into bubble', async () => {
    await renderApp({ width: 1440 });
    expect(chatColumn()).toBeTruthy();
    act(() => setViewportWidth(1000));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.getByRole('button', { name: /^展开对话框/ })).toBeTruthy();
  });

  it('desktop chat floats full-height on right without reflow; left drag/arrows resize and save',
    async () => {
      const app = await renderApp({ width: 1440 });
      expect(chatColumn().getAttribute('data-docked')).toBeNull();
      expect(chatColumn().style.width).toBe('420px');
      expect(chatColumn().style.height).toBe('');
      expect(document.querySelector('.shell > .chat-dialog')).not.toBeNull();
      const grip = screen.getByRole('separator', { name: '调整对话框宽度（左右方向键）' });
      fireEvent.keyDown(grip, { key: 'ArrowLeft' });
      fireEvent.keyDown(grip, { key: 'ArrowUp' });
      expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ width: 436, full: true });
      fireEvent.pointerDown(grip, { button: 0, pointerId: 2, clientX: 1004, clientY: 300 });
      fireEvent.pointerMove(grip, { pointerId: 2, clientX: 940, clientY: 300 });
      fireEvent.pointerUp(grip, { pointerId: 2 });
      expect(app.state.shellPrefs.store.get().chatFrame.width).toBe(500);
    });

  it('top edge drags to resize height anchored to bottom, persists, double-click resets full',
    async () => {
      const app = await renderApp({ width: 1440 });
      const top = screen.getByRole('separator', { name: '调整对话框高度（上下方向键）' });
      fireEvent.pointerDown(top, { button: 0, pointerId: 3, clientX: 1200, clientY: 8 });
      fireEvent.pointerMove(top, { pointerId: 3, clientX: 1200, clientY: 208 });
      fireEvent.pointerUp(top, { pointerId: 3 });
      const full = window.innerHeight - 16;
      expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ height: full - 200, full: false });
      expect(chatColumn().style.height).toBe(`${full - 200}px`);
      expect(chatColumn().style.top).toBe('auto');
      fireEvent.pointerDown(top, { button: 0, pointerId: 4, clientX: 1200, clientY: 300 });
      fireEvent.pointerMove(top, { pointerId: 4, clientX: 1200, clientY: 900 });
      fireEvent.pointerUp(top, { pointerId: 4 });
      expect(app.state.shellPrefs.store.get().chatFrame.height).toBe(420);
      fireEvent.doubleClick(top);
      expect(app.state.shellPrefs.store.get().chatFrame.full).toBe(true);
      expect(chatColumn().style.height).toBe('');
      fireEvent.keyDown(top, { key: 'ArrowDown' });
      expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ height: full - 16, full: false });
      fireEvent.keyDown(top, { key: 'ArrowUp' });
      expect(app.state.shellPrefs.store.get().chatFrame.full).toBe(true);
      const corner = screen.getByRole('separator', { name: '调整对话框大小' });
      fireEvent.pointerDown(corner, { button: 0, pointerId: 5, clientX: 1000, clientY: 8 });
      fireEvent.pointerMove(corner, { pointerId: 5, clientX: 960, clientY: 108 });
      fireEvent.pointerUp(corner, { pointerId: 5 });
      expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ width: 460, height: full - 100, full: false });
    });

  it('Esc minimizes floating chat and returns focus to bubble', async () => {
    await renderApp();
    fireEvent.keyDown(chatInput(), { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^展开对话框/ })));
  });
});

describe('shell: Reading section (feed and books merged)', () => {
  it('Reading list shows feed, saved, books with count and progress; Library drops books', async () => {
    await renderApp({ seed: true, hash: '#/books' });
    await settle();
    const column = await screen.findByRole('complementary', { name: '阅读' });
    const library = within(column).getByRole('link', { name: /^全部图书/ });
    expect(library.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(library.querySelector('.column-count')?.textContent).toBe('5'));
    expect(within(column).getByRole('heading', { name: '图书馆' })).toBeTruthy();
    expect(within(column).getByRole('button', { name: /^信息流/ })).toBeTruthy();
    const reading = within(column).getAllByRole('link').slice(1).map((link) => link.textContent);
    expect(reading[0]).toMatch(/^浮生六记\d+%$/);
    expect(reading.some((text) => text?.startsWith('庄子'))).toBe(false);
    expect(within(column).getByRole('button', { name: '导入书' })).toBeTruthy();
    fireEvent.click(within(column).getByRole('link', { name: /^浮生六记/ }));
    await settle();
    expect(window.location.hash).toMatch(/^#\/books\/[^/]+/);
    expect(within(rail()).getByRole('button', { name: '阅读' }).getAttribute('aria-current')).toBe('page');
    navTo('资料库');
    await settle();
    expect(window.location.hash).toBe('#/library');
    const archive = screen.getByRole('complementary', { name: '资料库' });
    expect(within(archive).queryByText('图书馆')).toBeNull();
    expect(within(archive).queryByRole('heading', { name: '图书' })).toBeNull();
  });
});

describe('shell: Cmd+K global switcher', () => {
  it('Cmd+K opens switcher and Esc closes it; chat input and sending remain unaffected', async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '搜索和切换' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和切换' })).toBeNull());
  });
});

describe('shell: header and mobile layout', () => {
  it('every section opens with matching rail active state and secondary column heading', async () => {
    await renderApp();
    for (const label of RAIL_LABELS) {
      navTo(label);
      await settle();
      expect(within(rail()).getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-current'))
        .toBe('page');
      if (label !== '首页') {
        expect(screen.getByRole('complementary', { name: label })).toBeTruthy();
      }
    }
    navTo('首页');
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy();
  });

  it('mobile shows 5-tab bottom bar without sidebar; bubble opens full-screen shared draft', async () => {
    const app = await renderApp({ width: 390 });
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '栏目' })).toBeNull();
    const tabs = screen.getByRole('navigation', { name: '主导航' });
    expect(within(tabs).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '首页', 'Plasticine', '消息', '笔记', '更多',
    ]);
    act(() => app.state.conversationUi.setDraft('电脑上写的'));
    fireEvent.click(screen.getByRole('button', { name: /展开对话框/ }));
    expect(chatColumn().dataset.fullscreen).toBe('true');
    expect(chatInput()).toHaveProperty('value', '电脑上写的');
    fireEvent.click(screen.getByRole('button', { name: '关上对话' }));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
  });

});

describe('three-column shell: sign-in', () => {
  it('shows sign-in page without session; valid handle and password enter shell', async () => {
    const app = await renderApp({ signedIn: false });
    expect(await screen.findByRole('heading', { name: '登录' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'fake-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy());
    expect((await app.api.session.current())?.device.name).toBe('浏览器');
  });

  it('wrong password shows reason and stays on sign-in page', async () => {
    await renderApp({ signedIn: false });
    fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'not-the-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('密码不对'));
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy();
  });

  it('mid-session 401 returns to sign-in page while preserving draft', async () => {
    const app = await renderApp();
    fireEvent.change(chatInput(), { target: { value: '失效前写的' } });
    app.control.session.expire();
    navTo('笔记');
    await waitFor(() => expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy());
    expect(app.state.conversationUi.store.get().draft).toBe('失效前写的');
  });

  it('connected hides status dot; disconnected shows avatar badge announced to screen readers', async () => {
    const app = await renderApp();
    await settle();
    expect(within(rail()).getByRole('button', { name: '设置 · 我' })).toBeTruthy();
    act(() => {
      app.control.bus.offline = true;
      app.control.bus.disconnectAll();
    });
    await waitFor(() => expect(within(rail()).getByRole('button', { name: /^设置 · 我 · (连接中|未连接)/ }))
      .toBeTruthy());
  });
});
