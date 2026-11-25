import { useEffect, useState, type ReactNode } from 'react';
import type { Quote } from '../api/types.ts';
import { MenuItem, openAt, Popover, pointAnchor, type PopoverAnchor } from './popover.tsx';
import { useLongPressMenu } from './long-press-menu.ts';
import { quoteSelection } from './quote-registry.ts';

import { CONTEXT_MENU_EVENT } from './use-context-menu-close.ts';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

type Item = { label: string; icon: 'quote' | 'copy' | 'smile' | 'link'; shortcut?: string; run: () => void };

interface Open {
  anchor: PopoverAnchor;
  items: Item[];
  leaving: boolean;
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
  useLongPressMenu();
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
