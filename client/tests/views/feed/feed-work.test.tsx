import type { FakeApi } from '../../../src/api/fake/index.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { uncertainError } from '../../../src/api/errors.ts';
import { REFETCH_DELAY_MS } from '../../../src/state/snapshot-loader.ts';
import { NOW, renderApp, settle, HOME_HEADING } from '../../helpers.tsx';

async function row(): Promise<HTMLElement> { return screen.findByRole('listitem', { name: '隔离消息' }); }

/** 第二栏「来源」里的「收藏」（11-07 两层侧栏）。 */
function savedSegment(): HTMLElement {
  return within(screen.getByRole('complementary', { name: '信息流' })).getByRole('button', { name: /^收藏/ });
}

/** 第 3 批：卡底只留四个按钮，记想法在这一条的直达页（#/feed/<id>）。 */
function comments(): HTMLElement {
  return screen.getByRole('region', { name: '「隔离消息」的评论' });
}

function setup(fake: FakeApi): void {
  fake.control.feed.seedSource({ id: 'interest', kind: 'interest', label: '工具' });
  fake.control.feed.seedItem({ id: 'f1', title: '隔离消息', sourceId: 'interest', origin: 'feed',
    url: 'https://example.test/a/1', site: 'example.test' });
}

describe('信息流工作链', () => {
  it('收藏归信息流、和书签分开：点了是已收藏，书签不变；页头分段「收藏」只看收藏，取消收藏的从筛选里收走', async () => {
    const app = await renderApp({ hash: '#/feed', setup: (fake) => {
      setup(fake);
      fake.control.feed.seedItem({ id: 'f2', title: '另一条', sourceId: 'interest', origin: 'feed' });
    } });
    await row();
    await settle(REFETCH_DELAY_MS + 50);
    const bookmarksList = vi.spyOn(app.api.bookmarks, 'list');
    fireEvent.click(within(await row()).getByRole('button', { name: '收藏' }));
    await within(await row()).findByRole('button', { name: '已收藏' });
    await settle(REFETCH_DELAY_MS + 50);
    expect(bookmarksList, '信息流变了不再重拉书签').not.toHaveBeenCalled();
    expect((await app.api.bookmarks.list()).bookmarks).toEqual([]);
    expect(savedSegment().getAttribute('aria-current')).toBeNull();
    fireEvent.click(savedSegment());
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '另一条' })).toBeNull());
    expect(savedSegment().getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/feed');
    fireEvent.click(within(await row()).getByRole('button', { name: '已收藏' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '隔离消息' })).toBeNull());
    expect(screen.getByText('还没有收藏。')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('complementary', { name: '信息流' })).getByRole('button', { name: /^全部/ }));
    await screen.findByRole('listitem', { name: '另一条' });
    expect(within(await row()).getByRole('button', { name: '收藏' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('评论草稿跨页保留，回执丢失用同一标识核实，不多存一句；可引用到对话', async () => {
    const app = await renderApp({ hash: '#/feed/f1', setup });
    await row();
    fireEvent.change(within(comments()).getByRole('textbox', { name: '评论' }), { target: { value: '这条和我有关' } });
    act(() => { window.location.hash = '#/today'; });
    await waitFor(() => expect(document.querySelector('.feed-comments')).toBeNull());
    act(() => { window.location.hash = '#/feed/f1'; });
    await row();
    expect(within(comments()).getByRole('textbox', { name: '评论' })).toHaveProperty('value', '这条和我有关');
    const original = app.api.feed.comment.bind(app.api.feed);
    const post = vi.spyOn(app.api.feed, 'comment').mockImplementationOnce(async (id, body) => {
      await original(id, body);
      throw uncertainError('评论');
    });
    fireEvent.click(within(comments()).getByRole('button', { name: '发送评论' }));
    // 没了结的评论在卡底的操作行里给「再核实」。
    fireEvent.click(await within(await row()).findByRole('button', { name: '再核实' }));
    expect(await within(comments()).findByText('可以留意它与你关切的联系。')).toBeTruthy();
    expect((await app.api.feed.comments('f1')).comments).toHaveLength(2);
    expect(post.mock.calls[0]?.[1].requestId).toBe(post.mock.calls[1]?.[1].requestId);
    // 第 17 条：「讨论」开一条围绕这一条的旁聊（不再引到主线的输入框）。
    fireEvent.click(within(await row()).getByRole('button', { name: '讨论' }));
    await waitFor(async () => expect((await app.api.lines.list({ kind: 'side' })).lines[0]?.topic?.ref).toBe('f1'));
  });

  it('旧评论含双方原话且未完成回复保留原因；失败后只重试对应回复', async () => {
    const app = await renderApp({ hash: '#/feed/f1', setup: (fake) => {
      setup(fake);
      fake.control.feed.commentRows.set('f1', [{ id: 'old', itemId: 'f1', author: 'user', text: '旧评论原话',
        createdAt: NOW.toISOString(), replyTo: null, status: 'completed', error: null, migrated: true, version: 1 },
      { id: 'reply', itemId: 'f1', author: 'ai', text: '', createdAt: NOW.toISOString(), replyTo: 'old',
        status: 'failed', error: '额度不足', migrated: false, version: 1 }]);
    } });
    await row();
    expect(await screen.findByText('旧评论原话')).toBeTruthy();
    expect(screen.getByText('额度不足')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试这次回复' }));
    expect(await screen.findByText('接着这条评论。')).toBeTruthy();
    expect((await app.api.feed.comments('f1')).comments).toHaveLength(2);
  });

  it('加关注点同时出探索方向，快速重复只建一条；最近来源屏蔽后能恢复', async () => {
    const app = await renderApp({ hash: '#/feed', setup });
    await row();
    // 第 7 批第 10 条：关注点在第二栏「按关注点的新闻」的 ⋯ → 设置… 里。
    fireEvent.click(await screen.findByRole('button', { name: '「按关注点的新闻」的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '设置…' }));
    fireEvent.click(await screen.findByRole('button', { name: '加关注点' }));
    fireEvent.change(screen.getByLabelText('关注点名字'), { target: { value: '学习方法' } });
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: '学习 认知' } });
    const add = screen.getByRole('button', { name: '添加关注点' });
    fireEvent.click(add);
    fireEvent.click(add);
    await screen.findByRole('listitem', { name: '学习方法' });
    const sources = await app.api.feed.sources();
    const added = sources.interests.find((source) => source.label === '学习方法')!;
    expect(sources.interests.filter((source) => source.label === '学习方法')).toHaveLength(1);
    const recent = screen.getByRole('list', { name: '最近来源' });
    fireEvent.click(within(recent).getByRole('button', { name: '屏蔽' }));
    fireEvent.click(await within(recent).findByRole('button', { name: '恢复' }));
    expect(await within(recent).findByRole('button', { name: '屏蔽' })).toBeTruthy();
    expect((await app.api.feed.list({})).items).toHaveLength(1);
  });

  it('首页不摆今天的数（第 2 批：首页只有 回来汇报 · 等你 · 在做），工具从新标签页进', async () => {
    await renderApp({ hash: '#/today' });
    await screen.findByRole('heading', { level: 1, name: HOME_HEADING });
    expect(screen.queryByRole('contentinfo', { name: '今天的数' })).toBeNull();
    expect(window.location.hash).toBe('#/today');
  });
});
