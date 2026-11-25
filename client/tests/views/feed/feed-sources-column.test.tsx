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

describe('feed secondary rail: sources', () => {
  it('lists built-in and custom sources with counts/dots and switches sub-tabs at top', async () => {
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

  it('X tabs switch Following/For You/Bookmarks with new counts and tag source on cards', async () => {
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

  it('refresh triggers from header overflow or rail row and shows completion toast', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const refresh = vi.spyOn(app.api.feed, 'refreshSource');
    fireEvent.click(within(sources()).getByRole('button', { name: /^Reddit/ }));
    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: '「Reddit」的设置' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '现在刷新' }));
    expect(await screen.findByRole('status', {}, { timeout: 2_000 })).toHaveProperty('textContent', '暂无新内容');
    expect(refresh.mock.calls.map((call) => call[0])).toEqual(['src_r']);
    fireEvent.click(within(column()).getByRole('button', { name: '刷新全部来源' }));
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(1));
    expect(refresh.mock.calls.map((call) => call[0])).toContain('src_blog');
  });

  it('pausing dims name, shows pause bars, toggles Resume in menu; built-ins omit delete', async () => {
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

  it('Reddit row overflow refreshes or adds subreddit; selected subreddit header manages delete', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('Reddit');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['现在刷新', '加版块…']);
    fireEvent.click(screen.getByRole('menuitem', { name: '加版块…' }));
    const sheet = screen.getByRole('dialog', { name: '加来源' });
    expect(within(sheet).getByRole('tab', { name: 'Reddit' }).getAttribute('aria-selected')).toBe('true');
  });

  it('delete confirms consequences, returns to feed, removes unsaved items while keeping saved', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    openOne('r/neuroscience');
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const confirm = screen.getByRole('alertdialog', { name: '删除「r/neuroscience」？' });
    expect(confirm.textContent).toContain('收藏过的留在「收藏」里');
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(rowNames()).not.toContain('Reddit'));
    await waitFor(() => expect(titles()).toEqual(['收藏过的一篇', '本地优先软件的同步难题']));
  });

  it('Reddit settings updates sort order and source URL on save', async () => {
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

  it('desktop shows Sign In for logged-out X/Xiaohongshu opening web tab; hides once signed in', async () => {
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

describe('add source: Reddit', () => {
  it('previews latest 3 posts by subreddit and sort, shows errors, adds Reddit and sub to rail', async () => {
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
