// 信息流页（第 3 批，用户 11-04 定）：瀑布流卡片；页头分段 全部 · X · 订阅 · 新闻 · 收藏，右边「加来源」；命中关注点的
// 排前面、带关注点名；卡底 赞 · 收藏 · 讨论 · 不感兴趣 · 打开原文；整张卡不挂浮框（11-04），理由在 ⓘ；读失败可重读。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { networkError, uncertainError } from '../../../src/api/errors.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

const HOUR_MS = 60 * 60 * 1000;

function main(): HTMLElement {
  return screen.getByRole('main');
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

/** 看哪一路在第二栏选（11-07 两层侧栏）：全部 · 订阅 · 来源（X 关注、RSS、按关注点的新闻、抖音收藏、收藏）。 */
const SOURCES: Readonly<Record<string, string>> = { 全部: '全部', X: 'X 关注', 订阅: 'RSS', 新闻: '按关注点的新闻', 抖音: '抖音收藏', 收藏: '收藏' };

function segment(name: string): HTMLElement {
  return within(screen.getByRole('complementary', { name: '信息流' })).getByRole('button', { name: new RegExp(`^${SOURCES[name] ?? name}`) });
}

/** 关注点（多少、搜什么）在页头「加来源」打开的 Sheet 里。 */
function openSources(): HTMLElement {
  fireEvent.click(within(screen.getByRole('complementary', { name: '信息流' })).getByRole('button', { name: '加来源或订阅' }));
  return within(main()).getByRole('dialog', { name: '加来源' });
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
    author: { name: '林间', handle: 'linjian_dev', avatar: '/v2/mail-image?u=a&e=1&s=b' } });
  feed.seedItem({ id: 'f_blog', title: '本地优先软件的同步难题', sourceId: 'src_blog', origin: 'feed',
    site: 'blog.example.org', url: 'https://blog.example.org/p/1', summary: '联网之后该听谁的？', arrivedAt: ago(2),
    image: { src: '/v2/mail-image?u=c&e=1&s=d', ratio: 0.5 } });
  feed.seedItem({ id: 'f_hidden', title: '标题党', arrivedAt: ago(3), reaction: 'dislike' });
}

describe('信息流页', () => {
  it('X 的卡：头像、名字和 @账号，没有标题，正文保留换行；订阅的卡：站点首字、标题、配图按比例占位；时间常显', async () => {
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
    const image = blog.querySelector<HTMLImageElement>('img.feed-card-image');
    expect(image?.getAttribute('src')).toBe('/v2/mail-image?u=c&e=1&s=d');
    expect(image?.style.aspectRatio).toBe('1 / 0.5');
    expect(blog.querySelector('time')?.textContent).not.toBe('');
    // 不感兴趣的默认不在里面。
    expect(titles()).toEqual(['把记忆拆成两栏以后', '本地优先软件的同步难题', '多家厂商发布端侧大模型']);
  });

  it('分段：X · 订阅 · 新闻 · 收藏 各只列那一路；分着段时新到别路的一条不混进来', async () => {
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

  it('命中关注点的同一天里排前面，带陶土橙点和关注点名；新到一条普通的，先后照旧', async () => {
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

  it('卡片不挂浮框：来源靠头像 / 站点方块和名字；挑这条的理由收在 ⓘ 里；卡底有名字的图标按钮', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(within(board()).getAllByRole('listitem').every((row) => row.getAttribute('data-tip') === null)).toBe(true);
    expect(within(card('把记忆拆成两栏以后')).queryByRole('button', { name: '为什么推给你' })).toBeNull();
    const news = card('多家厂商发布端侧大模型');
    const why = within(news).getByRole('button', { name: '为什么推给你' });
    expect(why.getAttribute('data-tip')).toBe('你在留意端侧模型。');
    expect(why.getAttribute('aria-description')).toBe('你在留意端侧模型。');
    const names = within(news).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['为什么推给你', '赞', '收藏', '讨论', '不感兴趣']);
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

  it('卡底「讨论」开一条围绕这一条的旁聊（第 17 条），开好了直接过去', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    fireEvent.click(within(card('多家厂商发布端侧大模型')).getByRole('button', { name: '讨论' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/side\//));
    const side = (await app.api.lines.list({ kind: 'side' })).lines[0];
    expect(side?.title).toBe('讨论：多家厂商发布端侧大模型');
    expect(side?.topic?.ref).toBe('f_news');
  });

  it('加来源：关注点带档位，点「少」就改成少', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const sources = within(openSources()).getByRole('list', { name: '关注点' });
    const levels = within(sources).getByRole('group', { name: '「本地优先同步」的档位' });
    expect(within(levels).getByRole('button', { name: '正常' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(levels).getByRole('button', { name: '少' }));
    const less = (): HTMLElement => within(levels).getByRole('button', { name: '少' });
    await waitFor(() => expect(less().getAttribute('aria-pressed')).toBe('true'));
    expect((await app.api.feed.sources()).interests[0]?.level).toBe('less');
  });

  it('加来源里关注点显示实际搜索词，就地编辑后保存；「每个来源的开关和频率」去设置', async () => {
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
    fireEvent.click(within(sheet).getByRole('button', { name: '每个来源的开关和频率' }));
    const settings = await screen.findByRole('dialog', { name: '设置' });
    expect(within(settings).getByRole('button', { name: '浏览器与信息流' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings/browser');
  });

  it('搜索词保存回执丢失保留草稿，原请求重试后更新', async () => {
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

  it('读信息流失败：说出原因并给「重新读取」，点了卡片就出来', async () => {
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
    fireEvent.click(within(alert).getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(card('本地优先软件的同步难题')).toBeTruthy());
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});
