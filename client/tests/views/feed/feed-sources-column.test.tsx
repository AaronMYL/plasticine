// 第 7 批第 10、13 条：信息流来源都在第二栏管。每个来源一行（今天新来几条、暂停、上次没取到的小红点、电脑上没登录的
// 「登录」），点一行只看这一个来源；⋯ 里暂停 / 继续、删除（先问一句、写清后果）、设置…（Reddit 改排序）；「加来源」的
// Reddit 填版块名先看三条再加。

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
  it('每个来源一行：内置三种在前，Reddit、订阅各一行；个数、小红点（悬停看原因）；点一行只看这一个', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(rowNames()).toEqual(['X 关注', '抖音收藏', '按关注点的新闻', 'r/neuroscience', '慢工博客']);
    const reddit = within(sources()).getAllByRole('listitem')[3]!;
    expect(within(reddit).getByLabelText('2 条新的')).toBeTruthy();
    expect(reddit.querySelector('.reddit-mark')).not.toBeNull();
    const dot = within(sources()).getByRole('img', { name: /^上次没取到/ });
    expect(dot.getAttribute('data-tip')).toBe('订阅没有返回可读内容，请检查地址后再试。');
    fireEvent.click(within(reddit).getByRole('button', { name: /^r\/neuroscience/ }));
    await waitFor(() => expect(titles()).toEqual(['收藏过的一篇', 'Time cells replay in order']));
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'r/neuroscience' })).toBeTruthy();
    const card = within(screen.getByRole('main')).getByRole('listitem', { name: 'Time cells replay in order' });
    expect(card.getAttribute('data-kind')).toBe('reddit');
    expect(within(card).getByText('u/synapse_lab')).toBeTruthy();
  });

  it('⋯ 暂停：名字变淡、行尾两竖，菜单里变「继续」；内置的没有删除', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('按关注点的新闻');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent))
      .toEqual(['现在刷新', '设置…', '暂停']);
    fireEvent.click(screen.getByRole('menuitem', { name: '暂停' }));
    await waitFor(() => expect(within(sources()).getByRole('img', { name: '暂停了' })).toBeTruthy());
    expect((await app.api.feed.sources()).others.find((row) => row.ref === 'internal:news')?.level).toBe('off');
    menu('按关注点的新闻');
    expect(screen.getByRole('menuitem', { name: '继续' })).toBeTruthy();
  });

  it('⋯ 删除先问一句、写清后果；删了那一行没了，没收藏过的条目跟着拿掉，收藏过的留着', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('r/neuroscience');
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    const confirm = screen.getByRole('dialog', { name: '删除「r/neuroscience」' });
    expect(confirm.textContent).toContain('收藏过的留在「收藏」里');
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(rowNames()).not.toContain('r/neuroscience'));
    await waitFor(() => expect(titles()).toEqual(['收藏过的一篇', '本地优先软件的同步难题']));
  });

  it('⋯ 设置…：Reddit 改排序，存了来源的地址跟着换', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    menu('r/neuroscience');
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

  it('电脑上没登录 X：行尾「登录」，点了在 Plasticine 网页标签里打开 X；登录了就没有', async () => {
    const sites = vi.fn(() => Promise.resolve({ sites: [{ host: 'douyin.com', name: '抖音', password: false,
      since: null }] }));
    Object.assign(window, { plasticineDesktop: { version: '0.9.0', notify: () => undefined, logins: { sites } } });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const login = await within(sources()).findByRole('button', { name: '登录 X' });
    expect(within(sources()).queryByRole('button', { name: '登录抖音' })).toBeNull();
    fireEvent.click(login);
    expect(opened.mock.calls[0]?.[0] ?? '').toContain('x.com');
  });
});

describe('加来源 · Reddit', () => {
  it('填版块名先看最新三条；认不出、取不到写原因；排序换了重看；添加后第二栏多一行', async () => {
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
    await waitFor(() => expect(rowNames()).toContain('r/cogsci'));
    expect((await app.api.feed.sources()).others.find((row) => row.kind === 'reddit')?.query)
      .toBe('https://www.reddit.com/r/cogsci/new/.rss');
  });
});
