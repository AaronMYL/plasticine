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

describe('Reading: by source kind', () => {
  it('Xiaohongshu cards show author and source; top tabs filter Recommended vs Favorites', async () => {
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

  it('mobile scrolls source tabs horizontally and scopes header refresh to active kind', async () => {
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
