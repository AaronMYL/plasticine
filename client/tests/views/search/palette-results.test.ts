import { describe, expect, it } from 'vitest';
import type { LineView, SearchResult } from '../../../src/api/shared.ts';
import type { WebTab } from '../../../src/state/web-tabs.ts';
import type { WebBookmark } from '../../../src/views/bookmarks/bookmark-address.ts';
import { GROUP_MAX, paletteItems, searchRoute } from '../../../src/views/search/palette-results.ts';

const AT = '2026-11-07T08:00:00.000Z';

function result(kind: SearchResult['kind'], id: string, extra: Partial<SearchResult> = {}): SearchResult {
  return { kind, id, title: `${kind} ${id}`, excerpt: '', updatedAt: AT, detail: '', ...extra };
}

function tab(id: string, title: string): WebTab {
  return { id, kind: 'web', url: `https://${id}.example.com/`, title, openedBy: 'user', openedAt: AT, visitedAt: AT };
}

function bookmark(id: string, title: string, target: string): WebBookmark {
  return { id, kind: 'web', title, target, projectId: null, tabs: [], origin: 'manual', feedItemId: null,
    snapshotChars: 0, position: 0, suggestedProjectId: null, createdAt: AT, updatedAt: AT, version: 1 };
}

const SIDE = { id: 'side-1', kind: 'side', title: '周报的来源怎么选', updatedAt: AT } as LineView;

describe('Cmd+K results', () => {
  it('groups spaces, side chats, tabs, notes, and Ask Plasticine last with per-group cap', () => {
    const results = [result('note', 'n1'), result('space', 's1'), result('book', 'b1'),
      ...Array.from({ length: GROUP_MAX + 2 }, (_, index) => result('space', `s${index + 2}`))];
    const items = paletteItems({ query: '周报', results, tabs: [tab('t1', '周报模板 · 网页')], archived: [],
      bookmarks: [], sides: [SIDE], today: ['t1'], dayText: () => '周四' });
    expect([...new Set(items.map((item) => item.group))]).toEqual(['space', 'side', 'tab', 'note', 'book', 'ask']);
    expect(items.filter((item) => item.group === 'space')).toHaveLength(GROUP_MAX);
    expect(items.at(-1)).toMatchObject({ group: 'ask', title: '「周报」', target: { kind: 'ask', text: '周报' } });
    expect(items.find((item) => item.group === 'tab')).toMatchObject({ meta: '网页 · 今天',
      target: { kind: 'tab', id: 't1' } });
  });

  it('empty query lists recent side chats and today\'s tabs without Ask Plasticine', () => {
    const items = paletteItems({ query: '', results: [], tabs: [tab('t1', 'A')], archived: [],
      bookmarks: [bookmark('bm1', 'A 书签', 'https://a.example.com/')], sides: [SIDE], today: ['t1'],
      dayText: () => '周四' });
    expect(items.map((item) => item.group)).toEqual(['side', 'tab']);
  });

  it('searches closed tabs and reopens on click', () => {
    const items = paletteItems({ query: 'arc', results: [], tabs: [], bookmarks: [],
      archived: [{ key: 'k1', url: 'https://arc.example.com/', title: 'Arc', closedAt: AT }], sides: [],
      today: [], dayText: () => '' });
    expect(items.map((item) => item.target.kind)).toEqual(['reopen', 'ask']);
  });

  it('lists bookmarks after tabs by name/URL/indexed body without duplicates or page bookmarks', () => {
    const bookmarks = [bookmark('bm1', '小红书', 'https://www.xiaohongshu.com/explore'),
      bookmark('bm2', '慢工博客', 'https://blog.example.org/'), bookmark('bm3', 'GitHub', 'https://github.com/')];
    const results = [result('bookmark', 'bm2', { title: '慢工博客', detail: 'https://blog.example.org/' }),
      result('bookmark', 'bm1', { title: '小红书' }), result('bookmark', 'bm-page', { title: '一篇笔记' })];
    const items = paletteItems({ query: '小红', results, tabs: [tab('t1', '小红书 · 网页')], archived: [], bookmarks,
      sides: [], today: [], dayText: () => '' });
    expect(items.map((item) => [item.group, item.title])).toEqual([['tab', '小红书 · 网页'], ['bookmark', '慢工博客'],
      ['bookmark', '小红书'], ['ask', '「小红」']]);
    expect(items[1]).toMatchObject({ meta: 'blog.example.org', lead: { kind: 'bookmark',
      url: 'https://blog.example.org/' }, target: { kind: 'bookmark', url: 'https://blog.example.org/',
      title: '慢工博客' } });
    const byUrl = paletteItems({ query: 'github.com', results: [], tabs: [], archived: [], bookmarks, sides: [],
      today: [], dayText: () => '' });
    expect(byUrl.map((item) => item.title)).toEqual(['GitHub', '「github.com」']);
  });

  it('jumps to chat message by thread type and opens matched book', () => {
    expect(searchRoute(result('message', 'line:line-main:3', { lineKind: 'main' })))
      .toEqual({ view: 'plasticine', noteId: null, messageId: 'line:line-main:3' });
    expect(searchRoute(result('message', 'line:side-1:2', { lineKind: 'side' })))
      .toEqual({ view: 'plasticine', noteId: null, lineId: 'side-1' });
    expect(searchRoute(result('message', 'line:bg-9:4', { lineKind: 'background' })))
      .toEqual({ view: 'work', noteId: null, lineId: 'bg-9' });
    expect(searchRoute(result('book', 'b1'))).toEqual({ view: 'books', noteId: null, bookId: 'b1' });
  });

  it('includes URL/tabId for tab favicon and space id for library-matching type icon', () => {
    const items = paletteItems({ query: '周报', results: [result('space', 's1')], bookmarks: [],
      tabs: [tab('t1', '周报 · 网页')],
      archived: [], sides: [], today: ['t1'], dayText: () => '' });
    expect(items.find((item) => item.group === 'space')?.lead).toEqual({ kind: 'space', spaceId: 's1' });
    expect(items.find((item) => item.group === 'tab')?.lead).toEqual({ kind: 'tab', url: 'https://t1.example.com/',
      tabId: 't1' });
  });
});
