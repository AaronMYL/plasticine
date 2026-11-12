// 右键菜单（11-12 第 1、2 条）：界面里的右键由 Plasticine 自己画，和「⋯」同一套弹层（popover.tsx）。
// - 能打字的地方（输入框、笔记正文）和图片照旧交给系统菜单：要拼写建议、剪切粘贴、复制图片。
// - 一行（标了 data-context-row）：就是这一行的「⋯」（data-row-menu），在右键那一点打开。
// - 内容区选中了字：「引用 · 复制」；点在一条消息上（data-context-message）：「引用这条 · 加个表情 · 复制这条」。
// - 左侧栏和图标栏里没有对应菜单的地方：什么都不出，不再给「引用 · 复制」。
// 右键一按先发 CONTEXT_MENU_EVENT，选中后的小条借它收起：同一时间只出一个浮层。手机（粗指针）不管，交给系统。

import { useEffect, useState, type ReactNode } from 'react';
import type { Quote } from '../api/types.ts';
import { MenuItem, openAt, Popover, pointAnchor, type PopoverAnchor } from './popover.tsx';
import { quoteSelection } from './quote-registry.ts';

import { CONTEXT_MENU_EVENT } from './use-context-menu-close.ts';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

type Item = { label: string; icon: 'quote' | 'copy' | 'smile' | 'link'; shortcut?: string; run: () => void };

interface Open {
  anchor: PopoverAnchor;
  items: Item[];
  /** 正在淡出：播完再拿掉。 */
  leaving: boolean;
  /** 每次右键一个新号：换一处右键时整个重开，不在旧位置上改。 */
  key: number;
}

function quoteKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⇧⌘L' : 'Ctrl+Shift+L';
}

function copyKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘C' : 'Ctrl+C';
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).catch((cause: unknown) => {
    console.warn('右键「复制」没写进剪贴板', cause);
  });
}

function selectionItems(add: (quote: Quote) => void): Item[] | null {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString();
  if (text.trim() === '') return null;
  // 点菜单时选区可能已经收起：先记下这一段，点「引用」时放回去再引。
  const range = selection.getRangeAt(0).cloneRange();
  return [
    { label: '引用', icon: 'quote', shortcut: quoteKey(), run: () => {
      const now = document.getSelection();
      now?.removeAllRanges();
      now?.addRange(range);
      quoteSelection(add, now);
    } },
    { label: '复制', icon: 'copy', shortcut: copyKey(), run: () => copy(text) },
  ];
}

function messageItems(message: Element, x: number, y: number): Item[] {
  const items: Item[] = [];
  const quote = message.querySelector<HTMLElement>('[data-message-action="quote"]');
  if (quote !== null) items.push({ label: '引用这条', icon: 'quote', run: () => quote.click() });
  const react = message.querySelector<HTMLElement>('[data-message-action="react"]');
  if (react !== null) items.push({ label: '加个表情', icon: 'smile', run: () => openAt(react, x, y) });
  const text = message.getAttribute('data-message-text') ?? '';
  if (text !== '') items.push({ label: '复制这条', icon: 'copy', run: () => copy(text) });
  return items;
}

function linkItems(target: Element): Item[] {
  const link = target.closest<HTMLAnchorElement>('a[href^="http"]');
  return link === null ? [] : [{ label: '复制链接地址', icon: 'link', run: () => copy(link.href) }];
}

/** 这一次右键要出的菜单；null = 交给系统；[] = 什么都不出。 */
export function contextItems(target: Element, x: number, y: number, add: (quote: Quote) => void): Item[] | null {
  if (target.closest(EDITABLE) !== null || (target instanceof HTMLElement && target.isContentEditable)) return null;
  if (target.closest('img, video') !== null) return null;
  const row = target.closest('[data-context-row]');
  const rowMenu = row?.querySelector<HTMLElement>('[data-row-menu]') ?? null;
  if (rowMenu !== null) {
    openAt(rowMenu, x, y);
    return [];
  }
  const selected = selectionItems(add);
  if (selected !== null) return [...selected, ...linkItems(target)];
  const message = target.closest('[data-context-message]');
  if (message !== null) return messageItems(message, x, y);
  const link = linkItems(target);
  if (link.length > 0) return link;
  if (target.closest('.column, .rail, [data-context-row]') !== null) return [];
  return null;
}

export function ContextMenuLayer({ add }: { add: (quote: Quote) => void }): ReactNode {
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    const onMenu = (event: MouseEvent): void => {
      if (window.matchMedia?.('(pointer: coarse)').matches === true) return;
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || target.closest('.popover') !== null) return;
      window.dispatchEvent(new Event(CONTEXT_MENU_EVENT));
      const items = contextItems(target, event.clientX, event.clientY, add);
      if (items === null) return;
      event.preventDefault();
      setOpen(items.length === 0 ? null : { anchor: pointAnchor(event.clientX, event.clientY), items,
        leaving: false, key: event.timeStamp });
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, [add]);
  if (open === null) return null;
  const close = (): void => setOpen((current) => current === null ? null : { ...current, leaving: true });
  return <Popover key={open.key} anchor={open.anchor} role="menu" label="右键菜单" leaving={open.leaving}
    onLeft={() => setOpen((current) => current?.leaving === true ? null : current)} onClose={close}>
    {open.items.map((item) => <MenuItem key={item.label} icon={item.icon} label={item.label}
      shortcut={item.shortcut} onSelect={() => {
        close();
        item.run();
      }} />)}
  </Popover>;
}
