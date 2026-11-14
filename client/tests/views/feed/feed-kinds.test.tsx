// 第13批阅读按种类分（设计稿「阅读来源与筛选」「阅读手机」）：小红书的卡写作者和「小红书」，顶上推荐 / 收藏；手机上页头
// 是刷新和「管理来源」，下面一排种类、一排这一种的筛选，不写这一种的名字。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { XHS_SOURCE_ID } from '../../../src/api/fake/fake-feed.ts';
import { renderApp, settle } from '../../helpers.tsx';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function titles(): (string | null)[] {
  const board = within(main()).getByRole('region', { name: '条目' });
  return within(board).queryAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
}

function seed(fake: FakeApi): void {
  const { feed } = fake.control;
  feed.seedSource({ id: 'src_r', kind: 'reddit', label: 'r/neuroscience',
    query: 'https://www.reddit.com/r/neuroscience/.rss' });
  feed.seedItem({ id: 'f_r', title: 'Time cells replay in order', sourceId: 'src_r', origin: 'feed' });
  feed.seedItem({ id: 'f_note', title: '周末去哪儿拍银杏', sourceId: XHS_SOURCE_ID, origin: 'feed',
    places: ['recommend'], author: { name: '阿柚', handle: null, avatar: null } });
  feed.seedItem({ id: 'f_kept', title: '一周备餐清单', sourceId: XHS_SOURCE_ID, origin: 'feed', places: ['saved'],
    author: { name: '小满厨房', handle: null, avatar: null } });
}

describe('阅读 · 按种类', () => {
  it('小红书：卡上写作者和「小红书」，顶上推荐 / 收藏，点收藏只列收藏的', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const column = screen.getByRole('complementary', { name: '阅读' });
    fireEvent.click(within(column).getByRole('button', { name: /^小红书/ }));
    await waitFor(() => expect(titles()).toEqual(['周末去哪儿拍银杏', '一周备餐清单']));
    const note = within(main()).getByRole('listitem', { name: '周末去哪儿拍银杏' });
    expect(note.getAttribute('data-kind')).toBe('xhs');
    expect(note.querySelector('.feed-card-name')?.textContent).toBe('阿柚');
    expect(note.querySelector('.feed-card-handle')?.textContent).toBe('小红书');
    const chips = within(main()).getByRole('group', { name: '看哪一处' });
    expect(within(chips).getAllByRole('button').map((chip) => chip.firstChild?.textContent))
      .toEqual(['全部', '推荐', '收藏']);
    fireEvent.click(within(chips).getByRole('button', { name: /^收藏/ }));
    await waitFor(() => expect(titles()).toEqual(['一周备餐清单']));
  });

  it('手机：一排种类横着滑，点一种就是这一种；页头的刷新跟着变成刷新这一种；不写名字', async () => {
    await renderApp({ hash: '#/feed', width: 390, setup: seed });
    await settle();
    const kinds = within(main()).getByRole('group', { name: '看哪一种' });
    expect(within(kinds).getAllByRole('button').map((chip) => chip.textContent))
      .toEqual(['全部', '兴趣', 'X', '小红书', '抖音收藏', 'Reddit']);
    expect(within(kinds).getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(kinds).getByRole('button', { name: 'Reddit' }));
    await waitFor(() => expect(titles()).toEqual(['Time cells replay in order']));
    expect(within(kinds).getByRole('button', { name: 'Reddit' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(main()).getByRole('button', { name: '刷新Reddit' })).toBeTruthy();
    expect(within(main()).getByRole('group', { name: '看哪一处' })).toBeTruthy();
    expect(within(main()).queryByRole('heading', { name: 'Reddit' })).toBeNull();
  });
});
