// 「引用到对话」（11-11 第 8 条）：右键菜单和 ⌘⇧L / Ctrl+Shift+L 都走这里。
// 有自己引用方式的地方（笔记、书、消息）挂一个处理：选区落在它里面就交给它（带原文位置、能回到原文）。
// 别处的选区按普通引用：来源取最近的 data-quote-label，再不行取这一页的大标题。

import { useEffect, useRef } from 'react';
import type { Quote } from '../api/types.ts';

export interface QuoteHandler {
  root: () => Element | null;
  /** 把这段选区引用到对话；交了返回 true。 */
  quote: (selection: Selection) => boolean;
}

const handlers = new Set<QuoteHandler>();

export function registerQuoteHandler(handler: QuoteHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** 页面挂自己的引用处理：root 给出它管的那块；两个函数每次渲染都可以是新的。quote 为 null 时不挂。 */
export function useQuoteHandler(root: () => Element | null, quote: ((selection: Selection) => boolean) | null): void {
  const latest = useRef({ root, quote });
  latest.current = { root, quote };
  const enabled = quote !== null;
  useEffect(() => {
    if (!enabled) return undefined;
    return registerQuoteHandler({ root: () => latest.current.root(),
      quote: (selection) => latest.current.quote?.(selection) ?? false });
  }, [enabled]);
}

function elementOf(node: Node | null): Element | null {
  if (node === null) return null;
  return node instanceof Element ? node : node.parentElement;
}

/** 选区在哪些处理里：取最里层的那个。 */
function handlerFor(anchor: Node): QuoteHandler | null {
  let best: { handler: QuoteHandler; root: Element } | null = null;
  for (const handler of handlers) {
    const root = handler.root();
    if (root === null || !root.contains(anchor)) continue;
    if (best === null || best.root.contains(root)) best = { handler, root };
  }
  return best?.handler ?? null;
}

function sourceLabel(anchor: Element | null): string {
  const marked = anchor?.closest('[data-quote-label]')?.getAttribute('data-quote-label')?.trim();
  if (marked !== undefined && marked !== '') return marked;
  const heading = anchor?.closest('.page, main, [role="main"]')?.querySelector('h1, h2')?.textContent?.trim();
  if (heading !== undefined && heading !== '') return heading;
  return '页面';
}

/** 普通引用：没有专门处理的地方选的一段字。 */
export function plainQuote(text: string, label: string, sourceId: string): Quote {
  return { id: `quote:${sourceId}:${text}`, kind: 'object', sourceId, label, text };
}

export type QuoteOutcome = 'quoted' | 'empty';

/** 把当前选区引用到对话：有专门处理就交给它，没有就按普通引用交给 add。 */
export function quoteSelection(add: (quote: Quote) => void, selection: Selection | null = document.getSelection()):
  QuoteOutcome {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return 'empty';
  const text = selection.toString().trim();
  const anchor = selection.anchorNode;
  if (text === '' || anchor === null) return 'empty';
  const handler = handlerFor(anchor);
  if (handler !== null && handler.quote(selection)) return 'quoted';
  add(plainQuote(text, sourceLabel(elementOf(anchor)), `page:${window.location.hash || '#'}`));
  return 'quoted';
}

/** 网页标签里选的一段（桌面壳右键菜单交过来）：来源是网页标题和地址。 */
export function webQuote(text: string, url: string, title: string): Quote {
  return { id: `quote:web:${url}:${text}`, kind: 'object', sourceId: url, label: title.trim() || url, text };
}
