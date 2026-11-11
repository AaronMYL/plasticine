// 「引用到对话」的两个入口（11-11 第 8 条）：⌘⇧L / Ctrl+Shift+L，和桌面壳右键菜单（__plasticineQuoteSelection）。
// 壳交过来的是 { from: 'ui' }（界面里的选区，在这边读）或 { from: 'web', text, url, title }（网页标签里的选区）。

import { useEffect } from 'react';
import type { Quote } from '../api/types.ts';
import { quoteSelection, webQuote } from './quote-registry.ts';

export const QUOTE_SHORTCUT = 'l';

type QuoteCommand = { from: 'ui' } | { from: 'web'; text: string; url: string; title: string };

function asCommand(value: unknown): QuoteCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.from === 'ui') return { from: 'ui' };
  if (record.from === 'web' && typeof record.text === 'string' && typeof record.url === 'string'
    && typeof record.title === 'string' && record.text.trim() !== '') {
    return { from: 'web', text: record.text.trim(), url: record.url, title: record.title };
  }
  return null;
}

/** add：引用片放进对话框并展开对话框（shell 的 webChrome.quote）。 */
export function useQuoteCommands(add: (quote: Quote) => void): void {
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== QUOTE_SHORTCUT) return;
      if (quoteSelection(add) === 'quoted') event.preventDefault();
    };
    window.__plasticineQuoteSelection = (value: unknown): void => {
      const command = asCommand(value);
      if (command === null) {
        console.warn('壳交来的引用看不懂，没放进对话框');
      } else if (command.from === 'ui') {
        quoteSelection(add);
      } else {
        add(webQuote(command.text, command.url, command.title));
      }
    };
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('keydown', keys);
      delete window.__plasticineQuoteSelection;
    };
  }, [add]);
}
