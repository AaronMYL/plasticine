// 「问这一页」开关（2026-11-04 第 2 批）不画界面的两样：哪些标签能问（新标签页、消息里和 Plasticine 的记录本身、
// 消息列表不能），这一页还能带多少字（一次引用的上限减去已有的引用片和标题网址的余量；段数满了不带）。

import { describe, expect, it } from 'vitest';
import { CONVERSATION_QUOTE_MAX_CHARS, CONVERSATION_QUOTE_MAX_COUNT } from '../../../src/api/shared.ts';
import type { Quote } from '../../../src/api/types.ts';
import type { CurrentTab } from '../../../src/shell/current-tab-context.ts';
import { askablePage, pageBudget } from '../../../src/views/conversation/ask-page-toggle.tsx';

function tab(route: CurrentTab['route'], kind: CurrentTab['kind'] = 'page'): CurrentTab {
  return { id: 't', kind, title: '一页', route, url: kind === 'web' ? 'https://example.com/' : null };
}

function quote(text: string): Quote {
  return { id: text.slice(0, 8), kind: 'object', sourceId: 's', label: '一段', text };
}

describe('问这一页', () => {
  it('网页、笔记、和某人的聊天能问；新标签页、消息列表、和 Plasticine 的记录不能', () => {
    expect(askablePage(tab(null, 'web'))).toBe(true);
    expect(askablePage(tab({ view: 'notes', noteId: 'n1' }))).toBe(true);
    expect(askablePage(tab({ view: 'messages', noteId: null, contactId: 'c_linyi' }))).toBe(true);
    expect(askablePage(tab({ view: 'web', noteId: null, webTabId: null }))).toBe(false);
    expect(askablePage(tab({ view: 'messages', noteId: null, contactId: null }))).toBe(false);
    expect(askablePage(tab({ view: 'plasticine', noteId: null }))).toBe(false);
    expect(askablePage(null)).toBe(false);
  });

  it('这一页能带的字 = 上限 − 已有引用片 − 余量；段数满了或字数用完不带', () => {
    const empty = pageBudget([]);
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(CONVERSATION_QUOTE_MAX_CHARS);
    expect(pageBudget([quote('一'.repeat(1000))])).toBe((empty ?? 0) - 1000);
    expect(pageBudget(Array.from({ length: CONVERSATION_QUOTE_MAX_COUNT }, (_, index) => quote(`第${index}段`))))
      .toBeNull();
    expect(pageBudget([quote('字'.repeat(CONVERSATION_QUOTE_MAX_CHARS))])).toBeNull();
  });
});
