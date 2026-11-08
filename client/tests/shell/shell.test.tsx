import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

describe('壳 · 两层侧栏（11-07 设计稿）', () => {
  it('图标栏三组入口（组间只留空隙不写组名），底部搜索、新建、头像；「现在」没有第二栏', async () => {
    await renderApp();
    const groups = [...rail().querySelectorAll('.rail-group')].map((group) => within(group as HTMLElement)
      .getAllByRole('button').map((button) => button.getAttribute('aria-label')));
    expect(groups).toEqual([['现在', 'Plasticine', '消息', '任务'], ['网页', '信息流'], ['笔记', '资料库']]);
    expect(within(rail()).getByRole('button', { name: '搜索和切换' })).toBeTruthy();
    expect(within(rail()).getByRole('button', { name: '新建…' })).toBeTruthy();
    expect(within(rail()).getByRole('button', { name: '设置 · 我' }).querySelector('.rail-avatar')?.textContent)
      .toBe('我');
    expect(within(rail()).getByRole('button', { name: '现在' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('.column')).toBeNull();
  });

  it('点入口第二栏换成这个栏目的列表，主区是它打开的那一个；入口回到这个栏目上次停在的地方', async () => {
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
    // 已经在这个栏目里再点入口：回到栏目开头。
    navTo('任务');
    await settle();
    expect(window.location.hash).toBe('#/tasks');
  });

  it('Plasticine 自己的页面是导航：前进后退走地址（⌘[ / ⌘]），不开标签', async () => {
    await renderApp();
    navTo('笔记');
    await settle();
    navTo('信息流');
    await settle();
    expect(window.location.hash).toBe('#/feed');
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    fireEvent.keyDown(window, { key: ']', metaKey: true });
    await waitFor(() => expect(window.location.hash).toBe('#/feed'));
    expect(screen.queryByRole('list', { name: '标签' })).toBeNull();
  });

  it('设置是弹框，从头像打开；里面有原「系统」，关了焦点回到头像', async () => {
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
      .map((button) => button.textContent)).toEqual(['通用', 'AI', '日常', '浏览器与信息流', '账号', '系统']);
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

  it('旧地址 #/settings/<段>、#/device 开设置弹框跳到对应段，底下还是原来的标签；关了地址换回它的', async () => {
    await renderApp({ hash: '#/settings/notices' });
    await settle();
    let dialog = await screen.findByRole('dialog', { name: '设置' });
    expect(within(dialog).getByRole('button', { name: '账号' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings/account');
    fireEvent.keyDown(document, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull();
    expect(window.location.hash).toBe('#/today');
    act(() => { window.location.hash = '#/device'; });
    await settle();
    dialog = await screen.findByRole('dialog', { name: '设置' });
    expect(within(dialog).getByRole('button', { name: '系统' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings/system');
    expect(within(rail()).getByRole('button', { name: '现在' }).getAttribute('aria-current')).toBe('page');
  });

  it('设置开着时走到了别的地址，弹框收起、那一页照常打开', async () => {
    await renderApp({ hash: '#/settings/general' });
    await screen.findByRole('dialog', { name: '设置' });
    act(() => { window.location.hash = '#/projects'; });
    await settle();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull());
    expect(window.location.hash).toBe('#/projects');
  });

  it('有事等他时「任务」带一个陶土点；圆球写「等你 n」，在「现在」上圆球不带数', async () => {
    await renderApp({ width: 1200, setup: (fake) => {
      fake.control.asks.raise({ id: 'ask_wait', kind: 'decide', question: '首页卡片按类别还是按项目上色？',
        options: [{ id: 'a', label: '按类别', recommended: true, description: null }] });
    } });
    await settle();
    await waitFor(() => expect(within(rail()).getByRole('button', { name: '任务 · 有等你的事' })).toBeTruthy());
    expect(rail().querySelectorAll('.rail-dot')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '展开对话框' })).toBeTruthy();
    navTo('笔记');
    await settle();
    expect(screen.getByRole('button', { name: '展开对话框，等你 1' })).toBeTruthy();
  });
});

describe('壳 · 悬浮对话框在所有标签上都在', () => {
  it('切标签后对话框的滚动位置、草稿、引用片都不变', async () => {
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
    for (const label of ['任务', '笔记', '资料库', '现在']) {
      navTo(label);
      await settle();
    }
    expect(within(chatColumn()).getByLabelText('对话记录').scrollTop).toBe(120);
    expect(chatInput().value).toBe('写到一半');
    expect(within(chatColumn()).getByLabelText('引用片').textContent).toContain('《摘记》');
  });

  it('主区每个视图记得自己的滚动位置', async () => {
    await renderApp();
    const main = screen.getByRole('main');
    main.scrollTop = 300;
    fireEvent.scroll(main);
    navTo('任务');
    await settle();
    expect(screen.getByRole('main').scrollTop).toBe(0);
    navTo('现在');
    await settle();
    expect(screen.getByRole('main').scrollTop).toBe(300);
  });

  it('缩成右下圆球；点开后滚动位置和草稿不变，展开与否记下来', async () => {
    const app = await renderApp();
    const list = within(chatColumn()).getByLabelText('对话记录');
    list.scrollTop = 80;
    fireEvent.scroll(list);
    fireEvent.change(chatInput(), { target: { value: '收起前的字' } });
    fireEvent.click(screen.getByRole('button', { name: '缩小对话框' }));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '展开对话框' }));
    expect(chatInput().value).toBe('收起前的字');
    expect(within(chatColumn()).getByLabelText('对话记录').scrollTop).toBe(80);
    expect(app.state.shellPrefs.store.get().chatOpen).toBe(true);
  });

  it('Plasticine 栏目本身就是对话：不显示对话框，也不显示圆球（旧地址 #/conversation 也到这里）', async () => {
    await renderApp({ hash: '#/conversation' });
    await waitFor(() => expect(window.location.hash).toBe('#/plasticine'));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.queryByRole('button', { name: /展开对话框/ })).toBeNull();
    expect(document.querySelector('[data-container="page"]')).not.toBeNull();
  });

  it('窗口从宽变窄：没选过时对话框缩成圆球', async () => {
    await renderApp({ width: 1440 });
    expect(chatColumn()).toBeTruthy();
    act(() => setViewportWidth(1000));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开对话框' })).toBeTruthy();
  });

  it('按住顶栏拖动挪位置、拖左上角调大小，松手记下来；键盘方向键也能调大小', async () => {
    const app = await renderApp();
    const head = chatColumn().querySelector('.chat-head') as HTMLElement;
    fireEvent.pointerDown(head, { button: 0, pointerId: 1, clientX: 1200, clientY: 300 });
    fireEvent.pointerMove(head, { pointerId: 1, clientX: 1000, clientY: 250 });
    fireEvent.pointerUp(head, { pointerId: 1 });
    expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ right: 224, bottom: 74 });
    const grip = screen.getByRole('separator', { name: '调整对话框大小（方向键）' });
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(app.state.shellPrefs.store.get().chatFrame).toMatchObject({ width: 436, height: 656 });
  });

  it('Esc 缩小对话框，焦点回到圆球', async () => {
    await renderApp();
    fireEvent.keyDown(chatInput(), { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开对话框' })));
  });
});

describe('壳 · ⌘K 全局切换', () => {
  it('⌘K 弹出、Esc 收起；对话框照常能输入发送', async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '搜索和切换' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和切换' })).toBeNull());
  });
});

describe('壳 · 页头与手机', () => {
  it('每个栏目都打得开，图标栏对着它；栏目有第二栏的第二栏写栏目名', async () => {
    await renderApp();
    for (const label of RAIL_LABELS) {
      navTo(label);
      await settle();
      expect(within(rail()).getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-current'))
        .toBe('page');
      if (label !== '现在') {
        expect(screen.getByRole('complementary', { name: label })).toBeTruthy();
      }
    }
    navTo('现在');
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy();
  });

  it('手机宽度：底栏 现在 · Plasticine · 消息 · 笔记 · 更多，没有侧栏；右下圆球展开是全屏对话，草稿共用', async () => {
    const app = await renderApp({ width: 390 });
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '栏目' })).toBeNull();
    const tabs = screen.getByRole('navigation', { name: '主导航' });
    expect(within(tabs).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '现在', 'Plasticine', '消息', '笔记', '更多',
    ]);
    act(() => app.state.conversationUi.setDraft('电脑上写的'));
    fireEvent.click(screen.getByRole('button', { name: /展开对话框/ }));
    expect(chatColumn().dataset.fullscreen).toBe('true');
    expect(chatInput()).toHaveProperty('value', '电脑上写的');
    fireEvent.click(screen.getByRole('button', { name: '关上对话' }));
    expect(screen.queryByRole('complementary', { name: '对话框' })).toBeNull();
  });

});

describe('三栏壳 · 登录', () => {
  it('没有会话时是配对页；输对配对码进壳', async () => {
    const app = await renderApp({ signedIn: false });
    expect(screen.getByRole('heading', { name: '配对这台设备' })).toBeTruthy();
    const code = app.control.session.issueCode();
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: code } });
    fireEvent.change(screen.getByLabelText('这台设备叫什么'), { target: { value: '书房的 Mac' } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy());
  });

  it('没填设备名时用「这台设备」配对（服务端要求设备名非空）', async () => {
    const app = await renderApp({ signedIn: false });
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: ` ${app.control.session.issueCode()} ` } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy());
    expect((await app.api.session.current())?.device.name).toBe('这台设备');
  });

  it('配对码不对：写原因，留在配对页', async () => {
    await renderApp({ signedIn: false });
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对码不对'));
  });

  it('会话中途失效：下一次请求拿到 401，回到配对页，草稿还在', async () => {
    const app = await renderApp();
    fireEvent.change(chatInput(), { target: { value: '失效前写的' } });
    app.control.session.expire();
    navTo('笔记');
    await waitFor(() => expect(screen.getByRole('heading', { name: '配对这台设备' })).toBeTruthy());
    expect(app.state.conversationUi.store.get().draft).toBe('失效前写的');
  });

  it('回执丢了（配对其实已落地）再点「配对」：用同一个 requestId，登进同一台设备，不多登记一台', async () => {
    const app = await renderApp({
      signedIn: false,
      setup: (fake) => fake.control.faults.next('pair', { kind: 'uncertain', landed: true }),
    });
    const pair = vi.spyOn(app.api.session, 'pair');
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: app.control.session.issueCode() } });
    fireEvent.change(screen.getByLabelText('这台设备叫什么'), { target: { value: '书房的 Mac' } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy());
    const [first, second] = pair.mock.calls.map(([input]) => input.requestId);
    expect(first).toMatch(/^req_/);
    expect(second).toBe(first);
    expect(await app.api.devices.list()).toHaveLength(1);
  });

  it('配对明确失败后改了码再试：换一个新的 requestId', async () => {
    const app = await renderApp({ signedIn: false });
    const pair = vi.spyOn(app.api.session, 'pair');
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对码不对'));
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: app.control.session.issueCode() } });
    fireEvent.click(screen.getByRole('button', { name: '配对' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HOME_HEADING })).toBeTruthy());
    const ids = pair.mock.calls.map(([input]) => input.requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('连着时不画连接灯；连不上时头像角上一个灯，读屏念出来', async () => {
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
