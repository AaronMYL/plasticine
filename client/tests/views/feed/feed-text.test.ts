// 信息流卡片上显示什么字（第 6 批第 8 条）：短帖直接显示中文全文；长帖先给中文摘要，展开是中文全文，还能切原文；
// 要截断的地方按句子断开。

import { describe, expect, it } from 'vitest';
import type { FeedItemView } from '../../../src/api/types.ts';
import { cutAtSentence, feedText } from '../../../src/views/feed/feed-text.ts';

const LONG_EN = 'We handed 4,800 backtested strategies to a model for three months. '.repeat(6);

function item(patch: Partial<FeedItemView>): Pick<FeedItemView, 'kind' | 'title' | 'summary' | 'zh'> {
  return { kind: 'x', title: 'Do not lead with numbers.', summary: 'Do not lead with numbers.', zh: null, ...patch };
}

describe('信息流卡片上的字', () => {
  it('短的外语帖：显示中文全文，写明译自哪种语言，能看原文', () => {
    const text = feedText(item({ zh: { state: 'done', lang: 'en', from: '英文', title: null,
      text: '融资时别急着给数字。', digest: null } }));
    expect(text).toMatchObject({ lead: '融资时别急着给数字。', expandable: false, from: '英文',
      original: 'Do not lead with numbers.', faded: false });
  });

  it('长帖：先给中文摘要，展开是中文全文', () => {
    const text = feedText(item({ summary: LONG_EN, title: LONG_EN, zh: { state: 'done', lang: 'en', from: '英文',
      title: null, text: '我们把 4,800 个回测过的交易策略交给模型跑了三个月。'.repeat(6), digest: '简单的规则活下来了。' } }));
    expect(text.lead).toBe('简单的规则活下来了。');
    expect(text.expandable).toBe(true);
    expect(text.full.startsWith('我们把 4,800')).toBe(true);
  });

  it('长帖还没有摘要：按句子截开头，末尾渐隐；没翻的照原文', () => {
    const text = feedText(item({ kind: 'rss', title: 'Strategies', summary: LONG_EN }));
    expect(text.lead.endsWith('months.')).toBe(true);
    expect(text.faded).toBe(true);
    expect(text.from).toBeNull();
    expect(text.full).toBe(LONG_EN);
  });

  it('正文和标题一字不差（小红书只有标题的笔记）：不再重复一遍', () => {
    const text = feedText(item({ kind: 'xhs', title: '桌面整理：一块木板', summary: ' 桌面整理：一块木板 ' }));
    expect(text).toMatchObject({ lead: '', full: '', expandable: false, title: '桌面整理：一块木板' });
  });

  it('按句子断开：中文句号、英文句号都认；找不到句子边界才硬切并加省略号', () => {
    expect(cutAtSentence('第一句很长很长。第二句也很长很长。第三句。', 12)).toEqual({ text: '第一句很长很长。', cut: true });
    expect(cutAtSentence('短的。', 12)).toEqual({ text: '短的。', cut: false });
    expect(cutAtSentence('一二三四五六七八九十一二三四五', 10)).toEqual({ text: '一二三四五六七八九十…', cut: true });
  });
});
