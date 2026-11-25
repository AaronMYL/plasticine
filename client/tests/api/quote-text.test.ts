import { describe, expect, it } from 'vitest';
import { lineQuoteInputs, splitQuotes, withQuotes } from '../../src/api/quote-text.ts';
import { quoteCharacters, withResolvedQuotes } from '../../src/api/shared.ts';

describe('quote chips travel with message body', () => {
  it('space quote preserves version, section, and paragraph across send and history roundtrip', () => {
    const text = '第一段\n第二段';
    const spaceReference = { spaceId: 'space-quote', version: 2,
      anchor: { sectionId: 'methods', paragraph: 3, text } };
    const quote = { id: 'q1', kind: 'space' as const, sourceId: 'space-quote',
      label: '报告 · 阅读报告 · 第 3 段', text, spaceReference };
    expect(lineQuoteInputs([quote])).toEqual([{ kind: 'space', spaceReference }]);
    const content = withResolvedQuotes('展开这段', [quote]);
    expect(splitQuotes(content, 'm').quotes[0]?.spaceReference).toEqual(spaceReference);
    expect(splitQuotes(content, 'm').text).toBe('展开这段');
  });
  it('prepended quote chip roundtrips cleanly with multiline text and blank lines preserved', () => {
    const quotes = [
      { label: '《读书摘记》', text: '第一行\n\n第三行' },
      { label: '它 10:00 的回复', text: '先做第一件。' },
    ];
    const content = withQuotes('看看这段', quotes);
    expect(content.startsWith('> 〔引用〕《读书摘记》\n> 第一行\n>\n> 第三行\n\n')).toBe(true);
    const split = splitQuotes(content, 'm1');
    expect(split.text).toBe('看看这段');
    expect(split.quotes).toEqual([
      { id: 'm1_q0', label: '《读书摘记》', text: '第一行\n\n第三行' },
      { id: 'm1_q1', label: '它 10:00 的回复', text: '先做第一件。' },
    ]);
  });

  it('quote-only message can be sent and parses back with empty text', () => {
    const content = withQuotes('', [{ label: '《a》', text: 'x' }]);
    expect(content).toBe('> 〔引用〕《a》\n> x');
    expect(splitQuotes(content, 'm')).toEqual({ quotes: [{ id: 'm_q0', label: '《a》', text: 'x' }], text: '' });
  });

  it('plain text without quotes stays unchanged; standard Markdown blockquotes stay user text', () => {
    expect(withQuotes('一句', [])).toBe('一句');
    expect(splitQuotes('> 别人说的\n\n我的话', 'm')).toEqual({ quotes: [], text: '> 别人说的\n\n我的话' });
  });

  it('full snapshot preserves exact range, version, whitespace, emoji, and quote-like headers', () => {
    const text = '# 标题\n😀\n\n〔引用〕正文中的标记\n> 嵌套引用\n';
    const noteReference = { noteId: 'note_1', version: 3, scope: 'full' as const };
    const content = withResolvedQuotes('我的问题', [{ label: '《标题》', text, noteReference }]);
    expect(splitQuotes(content, 'm')).toEqual({ text: '我的问题',
      quotes: [{ id: 'm_q0', label: '《标题》', text, noteReference }] });
    expect(quoteCharacters('😀字')).toBe(2);
  });

  it('mixed old and new quotes preserve order; malformed range metadata is not silently dropped', () => {
    const text = '完整选段';
    const noteReference = { noteId: 'note_1', version: 2, scope: 'selection' as const, text };
    const content = withResolvedQuotes('', [{ label: '旧引用', text: '旧摘要' },
      { label: '新引用', text, noteReference }]);
    const split = splitQuotes(content, 'm');
    expect(split.quotes.map((quote) => quote.text)).toEqual(['旧摘要', text]);
    expect(split.quotes[1]?.noteReference).toEqual(noteReference);
    const broken = content.replace('"characters":4', '"characters":400');
    expect(splitQuotes(broken, 'm').quotes[1]?.text).toContain('〔笔记引用〕');
  });
});
