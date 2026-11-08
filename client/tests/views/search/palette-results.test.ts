// ⌘K 的结果分组（11-07 设计稿 Palette）：空间 · 旁聊 · 标签 · 笔记 · 对话 · 记忆 · 信息流 · 图书，最后一组「让 Plasticine 做」；
// 每组最多几条；对话的一句按线的种类跳：主线到那一句，旁聊开那条旁聊，后台线开它的工作详情；图书能搜到。

import { describe, expect, it } from 'vitest';
import type { LineView, SearchResult } from '../../../src/api/shared.ts';
import type { WebTab } from '../../../src/state/web-tabs.ts';
import { GROUP_MAX, paletteItems, searchRoute } from '../../../src/views/search/palette-results.ts';

const AT = '2026-11-07T08:00:00.000Z';

function result(kind: SearchResult['kind'], id: string, extra: Partial<SearchResult> = {}): SearchResult {
  return { kind, id, title: `${kind} ${id}`, excerpt: '', updatedAt: AT, detail: '', ...extra };
}

function tab(id: string, title: string): WebTab {
  return { id, kind: 'web', url: `https://${id}.example.com/`, title, openedBy: 'user', openedAt: AT, visitedAt: AT };
}

const SIDE = { id: 'side-1', kind: 'side', title: '周报的来源怎么选', updatedAt: AT } as LineView;

describe('⌘K 的结果', () => {
  it('按组排：空间、旁聊、标签、笔记……最后是「让 Plasticine 做」；每组最多几条', () => {
    const results = [result('note', 'n1'), result('space', 's1'), result('book', 'b1'),
      ...Array.from({ length: GROUP_MAX + 2 }, (_, index) => result('space', `s${index + 2}`))];
    const items = paletteItems({ query: '周报', results, tabs: [tab('t1', '周报模板 · 网页')], archived: [],
      sides: [SIDE], today: ['t1'], dayText: () => '周四' });
    expect([...new Set(items.map((item) => item.group))]).toEqual(['space', 'side', 'tab', 'note', 'book', 'ask']);
    expect(items.filter((item) => item.group === 'space')).toHaveLength(GROUP_MAX);
    expect(items.at(-1)).toMatchObject({ group: 'ask', title: '「周报」', target: { kind: 'ask', text: '周报' } });
    expect(items.find((item) => item.group === 'tab')).toMatchObject({ meta: '网页 · 今天',
      target: { kind: 'tab', id: 't1' } });
  });

  it('没打字时列最近的旁聊和今天的标签，没有「让 Plasticine 做」', () => {
    const items = paletteItems({ query: '', results: [], tabs: [tab('t1', 'A')], archived: [], sides: [SIDE],
      today: ['t1'], dayText: () => '周四' });
    expect(items.map((item) => item.group)).toEqual(['side', 'tab']);
  });

  it('关掉的标签也搜得到，点了重开；书签不单列（已经搬进竖排标签）', () => {
    const items = paletteItems({ query: 'arc', results: [result('bookmark', 'bm1')], tabs: [],
      archived: [{ key: 'k1', url: 'https://arc.example.com/', title: 'Arc', closedAt: AT }], sides: [],
      today: [], dayText: () => '' });
    expect(items.map((item) => item.target.kind)).toEqual(['reopen', 'ask']);
  });

  it('对话的一句按线的种类跳；图书打开那本书', () => {
    expect(searchRoute(result('message', 'line:line-main:3', { lineKind: 'main' })))
      .toEqual({ view: 'plasticine', noteId: null, messageId: 'line:line-main:3' });
    expect(searchRoute(result('message', 'line:side-1:2', { lineKind: 'side' })))
      .toEqual({ view: 'plasticine', noteId: null, lineId: 'side-1' });
    expect(searchRoute(result('message', 'line:bg-9:4', { lineKind: 'background' })))
      .toEqual({ view: 'work', noteId: null, lineId: 'bg-9' });
    expect(searchRoute(result('book', 'b1'))).toEqual({ view: 'books', noteId: null, bookId: 'b1' });
  });

  it('行首：标签带网址和标签 id（画网站图标），空间带 id（按种类画图标，和资料库第二栏同一套）', () => {
    const items = paletteItems({ query: '周报', results: [result('space', 's1')], tabs: [tab('t1', '周报 · 网页')],
      archived: [], sides: [], today: ['t1'], dayText: () => '' });
    expect(items.find((item) => item.group === 'space')?.lead).toEqual({ kind: 'space', spaceId: 's1' });
    expect(items.find((item) => item.group === 'tab')?.lead).toEqual({ kind: 'tab', url: 'https://t1.example.com/',
      tabId: 't1' });
  });
});
