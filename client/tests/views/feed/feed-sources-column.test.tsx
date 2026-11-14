// 第 7 批第 10、13 条：信息流来源都在第二栏管；第13批每种一行（今天新来几条、暂停、上次没取到的小红点、电脑上没登录的
// 「登录」），进去顶上一排切同类里的哪一处 / 哪个版块；⋯ 里暂停 / 继续，一个版块的删除（先问一句、写清后果）、设置…
// （Reddit 改排序）在选着它时顶上的 ⋯ 里；「加来源」的 Reddit 填版块名先看三条再加。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp, settle } from '../../helpers.tsx';

function column(): HTMLElement {
  return screen.getByRole('complementary', { name: '阅读' });
}

function sources(): HTMLElement {
  return within(column()).getByRole('list', { name: '来源' });
}

function rowNames(): string[] {
  return within(sources()).getAllByRole('listitem').map((row) => row.querySelector('.column-item-text')?.textContent
    ?? '');
}

function titles(): (string | null)[] {
  const board = within(screen.getByRole('main')).getByRole('region', { name: '条目' });
  return within(board).queryAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
}

function menu(name: string): void {
  fireEvent.click(within(column()).getByRole('button', { name: `「${name}」的操作` }));
}

/** 进 Reddit、选中一个版块，开顶上的 ⋯。 */
function openOne(name: string): void {
  fireEvent.click(within(sources()).getByRole('button', { name: /^Reddit/ }));
  const chips = within(screen.getByRole('main')).getByRole('group', { name: '看哪一处' });
  fireEvent.click(within(chips).getByRole('button', { name: new RegExp(`^${name.replace('/', '\\/')}`) }));
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: `「${name}」的设置` }));
}

function seed(fake: FakeApi): void {
  const { feed } = fake.control;
  feed.seedSource({ id: 'src_r', kind: 'reddit', label: 'r/neuroscience',
    query: 'https://www.reddit.com/r/neuroscience/.rss' });
  feed.seedSource({ id: 'src_blog', kind: 'rss', label: '慢工博客', query: 'https://blog.example.org/feed',
    status: { checkedAt: new Date().toISOString(), okAt: null, error: '订阅没有返回可读内容，请检查地址后再试。' } });
  feed.seedItem({ id: 'f_r', title: 'Time cells replay in order', sourceId: 'src_r', origin: 'feed',
    author: { name: 'u/synapse_lab', handle: null, avatar: null } });
  feed.seedItem({ id: 'f_saved', title: '收藏过的一篇', sourceId: 'src_r', origin: 'feed', saved: true });
  feed.seedItem({ id: 'f_blog', title: '本地优先软件的同步难题', sourceId: 'src_blog', origin: 'feed' });
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

describe('信息流第二栏 · 来源', () => {
  it('每种一行：兴趣、X、小红书、抖音收藏在前，加过的 Reddit、博客各一行；个数、小红点；点一行进这一种，顶上按版块切', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(rowNames()).toEqual(['兴趣', 'X', '小红书', '抖音收藏', 'Reddit', '博客']);
    const reddit = within(sources()).getAllByRole('listitem')[4]!;
    expect(within(reddit).getByLabelText('2 条新的')).toBeTruthy();
    const dot = within(sources()).getByRole('img', { name: /^上次没取到/ });
    expect(dot.getAttribute('data-tip')).toBe('订阅没有返回可读内容，请检查地址后再试。');
    fireEvent.click(within(reddit).getByRole('button', { name: /^Reddit/ }));
    await waitFor(() => expect(titles()).toEqual(['收藏过的一篇', 'Time cells replay in order']));
    expect(within(reddit).getByRole('button', { name: /^Reddit/ }).getAttribute('aria-current')).toBe('page');
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Reddit' })).toBeTruthy();
    const chips = within(screen.getByRole('main')).getByRole('group', { name: '看哪一处' });
    expect(within(chips).getAllByRole('button').map((chip) => chip.firstChild?.textContent))
      .toEqual(['全部', 'r/neuroscience']);
    expect(within(chips).getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(chips).getByRole('button', { name: /^r\/neuroscience/ }));
    await waitFor(() => expect(within(chips).getByRole('button', { name: /^r\/neuroscience/ })
      .getAttribute('aria-pressed')).toBe('true'));
    expect(within(reddit).getByRole('button', { name: /^Reddit/ }).getAttribute('aria-current')).toBe('page');
    const card = within(screen.getByRole('main')).getByRole('listitem', { name: 'Time cells replay in order' });
    expect(card.getAttribute('data-kind')).toBe('reddit');
    expect(within(card).getByText('u/synapse_lab')).toBeTruthy();
  });

  it('X 顶上按在哪看到的切：正在关注 / 为你推荐 / 书签，有新的写个数；卡片名字后面标出哪一处', async () => {
    await renderApp({ hash: '#/feed', setup: (fake) => {
      seed(fake);
      fake.control.feed.seedItem({ id: 'f_follow', title: '关注的人发的', sourceId: 'src_x', origin: 'feed',
        places: ['following'] });
      fake.control.feed.seedItem({ id: 'f_both', title: '推荐里也有、还加了书签', sourceId: 'src_x', origin: 'feed',
        places: ['recommend', 'bookmark'] });
    } });
    await settle();
    fireEvent.click(within(sources()).getByRole('button', { name: /^X/ }));
    const chips = await within(screen.getByRole('main')).findByRole('group', { name: '看哪一处' });
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent))
      .toEqual(['全部2', '正在关注1', '为你推荐1', '书签1']);
    fireEvent.click(within(chips).getByRole('button', { name: /^书签/ }));
    await waitFor(() => expect(titles()).toEqual(['推荐里也有、还加了书签']));
    const card = within(screen.getByRole('main')).getByRole('listitem', { name: '推荐里也有、还加了书签' });
    expect([...card.querySelectorAll('.feed-place')].map((tag) => tag.textContent)).toEqual(['推荐', '书签']);
  });

  it('刷新：这一种名字旁边一个，第二栏「信息流」那一行一个；完了页面顶上浮一句', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const refresh = vi.spyOn(app.api.feed, 'refreshSource');
    fireEvent.click(within(sources()).getByRole('button', { name: /^Reddit/ }));
    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: '刷新Reddit' }));
    expect(await screen.findByRole('status', {}, { timeout: 2_000 })).toHaveProperty('textContent', '暂无新内容');
    expect(refresh.mock.calls.map((call) => call[0])).toEqual(['src_r']);
    fireEvent.click(within(column()).getByRole('button', { name: '刷新全部来源' }));
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(1));
    expect(refresh.mock.calls.map((call) => call[0])).toContain('src_blog');
  });

  it('⋯ 暂停：名字变淡、行尾两竖，菜单里变「继续」；内置的没有删除', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('兴趣');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent))
      .toEqual(['现在刷新', '设置…', '暂停']);
    fireEvent.click(screen.getByRole('menuitem', { name: '暂停' }));
    await waitFor(() => expect(within(sources()).getByRole('img', { name: '暂停了' })).toBeTruthy());
    expect((await app.api.feed.sources()).others.find((row) => row.ref === 'internal:news')?.level).toBe('off');
    menu('兴趣');
    expect(screen.getByRole('menuitem', { name: '继续' })).toBeTruthy();
  });

  it('Reddit 那一行的 ⋯：刷新这一种、加版块…；一个版块的删除、设置在选着它时顶上的 ⋯ 里', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('Reddit');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['现在刷新', '加版块…']);
    fireEvent.click(screen.getByRole('menuitem', { name: '加版块…' }));
    const sheet = screen.getByRole('dialog', { name: '加来源' });
    expect(within(sheet).getByRole('tab', { name: 'Reddit' }).getAttribute('aria-selected')).toBe('true');
  });

  it('删除先问一句、写清后果；删了那一种没了就回信息流，没收藏过的条目跟着拿掉，收藏过的留着', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    openOne('r/neuroscience');
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const confirm = screen.getByRole('dialog', { name: '删除「r/neuroscience」' });
    expect(confirm.textContent).toContain('收藏过的留在「收藏」里');
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(rowNames()).not.toContain('Reddit'));
    await waitFor(() => expect(titles()).toEqual(['收藏过的一篇', '本地优先软件的同步难题']));
  });

  it('⋯ 设置…：Reddit 改排序，存了来源的地址跟着换', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    openOne('r/neuroscience');
    fireEvent.click(screen.getByRole('menuitem', { name: '设置…' }));
    const sheet = screen.getByRole('dialog', { name: 'r/neuroscience · 设置' });
    const sort = within(sheet).getByRole('group', { name: '排序' });
    expect(within(sort).getByRole('button', { name: '热门' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sort).getByRole('button', { name: '本周最佳' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'r/neuroscience · 设置' })).toBeNull());
    expect((await app.api.feed.sources()).others.find((row) => row.id === 'src_r')?.query)
      .toBe('https://www.reddit.com/r/neuroscience/top/.rss?t=week');
  });

  it('电脑上没登录 X、小红书：行尾「登录」，点了在 Plasticine 网页标签里打开；登录了就没有', async () => {
    const sites = vi.fn(() => Promise.resolve({ sites: [{ host: 'douyin.com', name: '抖音', password: false,
      since: null }] }));
    Object.assign(window, { plasticineDesktop: { version: '0.9.0', notify: () => undefined, logins: { sites } } });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const login = await within(sources()).findByRole('button', { name: '登录 X' });
    expect(within(sources()).getByRole('button', { name: '登录小红书' })).toBeTruthy();
    expect(within(sources()).queryByRole('button', { name: '登录抖音' })).toBeNull();
    fireEvent.click(login);
    expect(opened.mock.calls[0]?.[0] ?? '').toContain('x.com');
  });
});

describe('加来源 · Reddit', () => {
  it('填版块名先看最新三条；认不出、取不到写原因；排序换了重看；添加后第二栏多出 Reddit，进去有这个版块', async () => {
    const app = await renderApp({ hash: '#/feed' });
    await settle();
    fireEvent.click(within(column()).getByRole('button', { name: '加来源' }));
    const sheet = screen.getByRole('dialog', { name: '加来源' });
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Reddit' }));
    const input = within(sheet).getByRole('textbox', { name: '版块名' });
    const add = within(sheet).getByRole('button', { name: '添加' });
    expect(add).toHaveProperty('disabled', true);
    const preview = vi.spyOn(app.api.feed, 'previewReddit');
    fireEvent.change(input, { target: { value: 'nowhere' } });
    expect(await within(sheet).findByText(/404/, {}, { timeout: 2_000 })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'r/cogsci' } });
    const posts = await within(sheet).findByRole('list', { name: '最新几条' }, { timeout: 2_000 });
    expect(within(posts).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(sheet).getByRole('button', { name: '最新' }));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0]).toEqual({ subreddit: 'cogsci', sort: 'new' }),
      { timeout: 2_000 });
    await waitFor(() => expect(add).toHaveProperty('disabled', false), { timeout: 2_000 });
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '加来源' })).toBeNull());
    await waitFor(() => expect(rowNames()).toContain('Reddit'));
    fireEvent.click(within(sources()).getByRole('button', { name: /^Reddit/ }));
    const chips = await within(screen.getByRole('main')).findByRole('group', { name: '看哪一处' });
    expect(within(chips).getByRole('button', { name: /^r\/cogsci/ })).toBeTruthy();
    expect((await app.api.feed.sources()).others.find((row) => row.kind === 'reddit')?.query)
      .toBe('https://www.reddit.com/r/cogsci/new/.rss');
  });
});
