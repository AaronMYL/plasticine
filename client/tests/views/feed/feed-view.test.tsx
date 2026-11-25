import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { networkError, uncertainError } from '../../../src/api/errors.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

const HOUR_MS = 60 * 60 * 1000;

function main(): HTMLElement {
  return screen.getByRole('main');
}

function mainArea(): HTMLElement {
  const area = main().closest<HTMLElement>('.shell-main-area');
  if (area === null) throw new Error('没有主区');
  return area;
}

function board(): HTMLElement {
  return within(main()).getByRole('region', { name: '条目' });
}

function card(title: string): HTMLElement {
  return within(board()).getByRole('listitem', { name: title });
}

function titles(): (string | null)[] {
  return within(board()).queryAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
}

const SOURCES: Readonly<Record<string, string>> = { 全部: '信息流', X: 'X', 订阅: '博客', 新闻: '兴趣',
  抖音: '抖音收藏', 收藏: '收藏' };

function column(): HTMLElement {
  return screen.getByRole('complementary', { name: '阅读' });
}

function segment(name: string): HTMLElement {
  return within(column()).getByRole('button', { name: new RegExp(`^${SOURCES[name] ?? name}`) });
}

function openSources(): HTMLElement {
  fireEvent.click(within(column()).getByRole('button', { name: '「兴趣」的操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '设置…' }));
  return within(mainArea()).getByRole('dialog', { name: '兴趣 · 设置' });
}

function ago(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString();
}

function seed(fake: FakeApi): void {
  const { feed } = fake.control;
  feed.seedSource({ id: 'src_sync', kind: 'interest', label: '本地优先同步', query: 'local-first' });
  feed.seedSource({ id: 'src_blog', kind: 'rss', label: '慢工博客', query: 'https://blog.example.org/feed' });
  feed.seedItem({ id: 'f_news', title: '多家厂商发布端侧大模型', sourceId: 'src_sync', origin: 'feed',
    site: 'news.example.com', url: 'https://news.example.com/a', summary: '本地跑百亿参数。', arrivedAt: ago(5),
    why: '你在留意端侧模型。' });
  feed.seedItem({ id: 'f_post', title: '把记忆拆成两栏以后', sourceId: 'src_x', origin: 'feed', arrivedAt: ago(1),
    url: 'https://x.com/linjian_dev/status/1', summary: '把记忆拆成两栏以后\n纠错次数降了一半。',
    author: { name: '林间', handle: 'linjian_dev', avatar: '/v2/mail-image?u=a&e=1&s=b' },
    image: { src: '/v2/mail-image?u=p1&e=1&s=q', ratio: 1 },
    moreImages: [{ src: '/v2/mail-image?u=p2&e=1&s=q', ratio: 1 },
      { src: '/v2/mail-image?u=p3&e=1&s=q', ratio: null }] });
  feed.seedItem({ id: 'f_blog', title: '本地优先软件的同步难题', sourceId: 'src_blog', origin: 'feed',
    site: 'blog.example.org', url: 'https://blog.example.org/p/1', summary: '联网之后该听谁的？', arrivedAt: ago(2),
    image: { src: '/v2/mail-image?u=c&e=1&s=d', ratio: 0.5 } });
  feed.seedItem({ id: 'f_hidden', title: '标题党', arrivedAt: ago(3), reaction: 'dislike' });
}

describe('feed page', () => {
  it('X cards show author/handle/newlines; subscribed cards show monogram/title/image/time', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const post = card('把记忆拆成两栏以后');
    expect(post.getAttribute('data-kind')).toBe('x');
    expect(post.querySelector('img.feed-mark')?.getAttribute('src')).toBe('/v2/mail-image?u=a&e=1&s=b');
    expect(within(post).getByText('林间')).toBeTruthy();
    expect(within(post).getByText('@linjian_dev')).toBeTruthy();
    expect(within(post).queryByRole('heading')).toBeNull();
    expect(post.querySelector('.feed-card-text')?.textContent).toBe('把记忆拆成两栏以后\n纠错次数降了一半。');
    const blog = card('本地优先软件的同步难题');
    expect(blog.querySelector('.feed-mark')?.textContent).toBe('慢');
    expect(within(blog).getByRole('heading', { name: '本地优先软件的同步难题' })).toBeTruthy();
    const image = blog.querySelector<HTMLImageElement>('.feed-card-media img');
    expect(image?.getAttribute('src')).toBe('/v2/mail-image?u=c&e=1&s=d');
    const cell = within(blog).getByRole('button', { name: '查看图片' });
    expect(cell.style.aspectRatio).toBe('1 / 0.5');
    fireEvent.click(cell);
    const viewer = await screen.findByRole('dialog', { name: '看图' });
    expect(viewer.querySelector('img')?.getAttribute('src')).toBe('/v2/mail-image?u=c&e=1&s=d');
    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '看图' })).toBeNull();
    expect(blog.querySelector('time')?.textContent).not.toBe('');
    const cells = within(post).getAllByRole('button', { name: /^查看图片/ });
    expect(cells).toHaveLength(3);
    fireEvent.click(cells[1]!);
    const album = await screen.findByRole('dialog', { name: '看图' });
    expect(album.textContent).toContain('2 / 3');
    expect(within(album).getByRole('link', { name: '打开原文' }).getAttribute('href'))
      .toBe('https://x.com/linjian_dev/status/1');
    fireEvent.keyDown(album, { key: 'Escape' });
    expect(titles()).toEqual(['把记忆拆成两栏以后', '本地优先软件的同步难题', '多家厂商发布端侧大模型']);
  });

  it('tabs isolate X, Blog, Interests, Saved so incoming items from other tabs do not leak in', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(segment('全部').getAttribute('aria-current')).toBe('page');
    fireEvent.click(segment('X'));
    await waitFor(() => expect(titles()).toEqual(['把记忆拆成两栏以后']));
    expect(segment('X').getAttribute('aria-current')).toBe('page');
    app.control.feed.seedItem({ id: 'f_late', title: '刚到的订阅文章', sourceId: 'src_blog', origin: 'feed',
      arrivedAt: ago(0.1) }, true);
    await settle();
    expect(titles()).toEqual(['把记忆拆成两栏以后']);
    fireEvent.click(segment('订阅'));
    await waitFor(() => expect(titles()).toEqual(['刚到的订阅文章', '本地优先软件的同步难题']));
    fireEvent.click(segment('新闻'));
    await waitFor(() => expect(titles()).toEqual(['多家厂商发布端侧大模型']));
    fireEvent.click(segment('收藏'));
    await waitFor(() => expect(titles()).toEqual([]));
    expect(within(main()).getByText('还没有收藏。')).toBeTruthy();
    fireEvent.click(segment('全部'));
    await waitFor(() => expect(titles()).toHaveLength(4));
  });

  it('interest matches sort first within same day with terracotta dot and interest label', async () => {
    const app = await renderApp({ hash: '#/feed', setup: (fake) => {
      seed(fake);
      fake.control.feed.seedItem({ id: 'f_hit', title: '命中关注点', sourceId: 'src_sync', origin: 'feed',
        concernId: 'c_sync', topic: '本地优先同步', arrivedAt: ago(4) });
    } });
    await settle();
    expect(titles()[0]).toBe('命中关注点');
    const hit = card('命中关注点').querySelector('.feed-hit');
    expect(hit?.textContent).toBe('本地优先同步');
    expect(hit?.querySelector('.feed-hit-dot')).not.toBeNull();
    expect(card('把记忆拆成两栏以后').querySelector('.feed-hit')).toBeNull();
    app.control.feed.seedItem({ id: 'f_latest', title: '刚到的普通一条', arrivedAt: ago(0.5) }, true);
    await waitFor(() => expect(titles().slice(0, 2)).toEqual(['命中关注点', '刚到的普通一条']));
  });

  it('cards avoid overlays: source via avatar/monogram, reason in info icon, labeled buttons', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(within(board()).getAllByRole('listitem').every((row) => row.getAttribute('data-tip') === null)).toBe(true);
    expect(within(card('把记忆拆成两栏以后')).queryByRole('button', { name: '为什么推给你' })).toBeNull();
    const news = card('多家厂商发布端侧大模型');
    const why = within(news).getByRole('button', { name: '为什么推给你' });
    expect(why.getAttribute('data-tip')).toBe('你在留意端侧模型。');
    expect(why.getAttribute('aria-description')).toBe('你在留意端侧模型。');
    const names = within(news).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['为什么推给你', '点赞', '收藏', '讨论', '不感兴趣']);
    const original = within(news).getByRole('link', { name: '打开原文' });
    expect(original.getAttribute('href')).toBe('https://news.example.com/a');
    expect(original.getAttribute('target')).toBe('_blank');
    expect(original.getAttribute('data-tip')).toBe('打开原文');
    fireEvent.click(within(news).getByRole('button', { name: '收藏' }));
    await waitFor(() => expect(within(card('多家厂商发布端侧大模型')).getByRole('button', { name: '已收藏' })
      .getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(within(card('多家厂商发布端侧大模型')).getByRole('button', { name: '不感兴趣' }));
    await within(card('多家厂商发布端侧大模型')).findByRole('button', { name: '撤销' });
    expect(app.control.feed.find('f_news')).toMatchObject({ reaction: 'dislike', saved: true });
  });

  it('Discuss inserts item into current composer without leaving page', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    fireEvent.click(within(card('多家厂商发布端侧大模型')).getByRole('button', { name: '讨论' }));
    expect(window.location.hash).toBe('#/feed');
    expect(app.state.conversationUi.store.get().quotes[0]?.sourceId).toBe('feed:f_news');
    expect((await app.api.mates.list()).legacyChats).toEqual([]);
  });

  it('interest settings show frequency tiers and clicking Less updates to low', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const sources = within(openSources()).getByRole('list', { name: '关注点' });
    const levels = within(sources).getByRole('group', { name: '「本地优先同步」的档位' });
    expect(within(levels).getByRole('button', { name: '正常' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(levels).getByRole('button', { name: '偏少' }));
    const less = (): HTMLElement => within(levels).getByRole('button', { name: '偏少' });
    await waitFor(() => expect(less().getAttribute('aria-pressed')).toBe('true'));
    expect((await app.api.feed.sources()).interests[0]?.level).toBe('less');
  });

  it('interest settings display actual search query and save inline edits', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const sheet = openSources();
    const row = within(sheet).getByRole('listitem', { name: '本地优先同步' });
    expect(row.textContent).toContain('搜：local-first');
    fireEvent.click(within(row).getByRole('button', { name: '编辑搜索词' }));
    fireEvent.change(within(row).getByLabelText('搜索词'), { target: { value: 'offline sync' } });
    fireEvent.click(within(row).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(row.textContent).toContain('搜：offline sync'));
    expect((await app.api.feed.sources()).interests[0]?.query).toBe('offline sync');
  });

  it('lost query-save receipt preserves draft and updates after retrying original request', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const write = vi.spyOn(app.api.feed, 'setSourceQuery').mockRejectedValueOnce(uncertainError('保存搜索词'));
    const row = within(openSources()).getByRole('listitem', { name: '本地优先同步' });
    fireEvent.click(within(row).getByRole('button', { name: '编辑搜索词' }));
    fireEvent.change(within(row).getByLabelText('搜索词'), { target: { value: '新的搜索' } });
    fireEvent.click(within(row).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(row.textContent).toContain('结果待核实'));
    expect(within(row).getByLabelText('搜索词')).toHaveProperty('value', '新的搜索');
    fireEvent.click(within(row).getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(row.textContent).toContain('搜：新的搜索'));
    expect(write.mock.calls[1]?.[1].requestId).toBe(write.mock.calls[0]?.[1].requestId);
  });

  it('feed load error shows reason and Retry button that loads cards on click', async () => {
    await renderApp({
      hash: '#/feed',
      setup: (fake) => {
        seed(fake);
        vi.spyOn(fake.api.feed, 'list').mockRejectedValueOnce(networkError('读信息流'));
      },
    });
    await settle();
    const alert = within(main()).getByRole('alert');
    expect(alert.textContent).toContain('读信息流：连不上服务。');
    fireEvent.click(within(alert).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(card('本地优先软件的同步难题')).toBeTruthy());
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});
