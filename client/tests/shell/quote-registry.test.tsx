import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '../../src/api/types.ts';
import { quoteSelection, registerQuoteHandler } from '../../src/shell/quote-registry.ts';
import { useQuoteCommands } from '../../src/shell/use-quote-commands.ts';

function select(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('引用到对话', () => {
  it('没有选中文字时什么都不做', () => {
    const add = vi.fn();
    expect(quoteSelection(add)).toBe('empty');
    expect(add).not.toHaveBeenCalled();
  });

  it('普通页面按最近的来源名引用', () => {
    document.body.innerHTML = '<section data-quote-label="联系人：林夏"><p id="t">下周三交稿</p></section>';
    select(document.getElementById('t')!);
    const add = vi.fn<(quote: Quote) => void>();
    expect(quoteSelection(add)).toBe('quoted');
    expect(add.mock.calls[0]?.[0]).toMatchObject({ kind: 'object', label: '联系人：林夏', text: '下周三交稿' });
  });

  it('选区在有专门处理的地方，交给最里层的处理', () => {
    document.body.innerHTML = '<div id="outer"><div id="inner"><p id="t">第三章</p></div></div>';
    const outer = vi.fn(() => true);
    const inner = vi.fn(() => true);
    const stops = [
      registerQuoteHandler({ root: () => document.getElementById('outer'), quote: outer }),
      registerQuoteHandler({ root: () => document.getElementById('inner'), quote: inner }),
    ];
    select(document.getElementById('t')!);
    const add = vi.fn();
    quoteSelection(add);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });

  it('⌘⇧L 引用当前选区；壳交来的网页选区带网页标题', () => {
    const add = vi.fn<(quote: Quote) => void>();
    function Probe(): null {
      useQuoteCommands(add);
      return null;
    }
    const view = render(<Probe />);
    document.body.insertAdjacentHTML('beforeend', '<h1 id="t">一段话</h1>');
    select(document.getElementById('t')!);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', metaKey: true, shiftKey: true }));
    expect(add.mock.calls[0]?.[0].text).toBe('一段话');
    window.__plasticineQuoteSelection?.({ from: 'web', text: ' 选中的 ', url: 'https://example.com/a', title: '示例' });
    expect(add.mock.calls[1]?.[0]).toMatchObject({ sourceId: 'https://example.com/a', label: '示例', text: '选中的' });
    view.unmount();
    expect(window.__plasticineQuoteSelection).toBeUndefined();
  });
});
