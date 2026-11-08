import { describe, expect, it } from 'vitest';
import { splitQuotes, withQuotes } from '../../src/api/quote-text.ts';
import { quoteCharacters, withResolvedQuotes } from '../../src/api/shared.ts';

describe('引用片随正文走', () => {
  it('引用片写进正文开头，存下后拆回来一样（多行、空行都在）', () => {
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

  it('只有引用没有话也能发；拆回来话是空的', () => {
    const content = withQuotes('', [{ label: '《a》', text: 'x' }]);
    expect(content).toBe('> 〔引用〕《a》\n> x');
    expect(splitQuotes(content, 'm')).toEqual({ quotes: [{ id: 'm_q0', label: '《a》', text: 'x' }], text: '' });
  });

  it('没有引用时原话不变；不是这个格式的正文（普通的 Markdown 引用）原样当用户的话', () => {
    expect(withQuotes('一句', [])).toBe('一句');
    expect(splitQuotes('> 别人说的\n\n我的话', 'm')).toEqual({ quotes: [], text: '> 别人说的\n\n我的话' });
  });

  it('全文快照拆回精确范围和版本，多行空白、表情及类似引用标题的文字完整保留', () => {
    const text = '# 标题\n😀\n\n〔引用〕正文中的标记\n> 嵌套引用\n';
    const noteReference = { noteId: 'note_1', version: 3, scope: 'full' as const };
    const content = withResolvedQuotes('我的问题', [{ label: '《标题》', text, noteReference }]);
    expect(splitQuotes(content, 'm')).toEqual({ text: '我的问题',
      quotes: [{ id: 'm_q0', label: '《标题》', text, noteReference }] });
    expect(quoteCharacters('😀字')).toBe(2);
  });

  it('新旧引用混合保留顺序；损坏的范围信息不被偷偷丢掉', () => {
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
