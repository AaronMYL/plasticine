import { BaseWindow, clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { contextMenuEntries, type MenuEntry } from './context-menu-template.ts';

export type QuoteFromMenu = (contents: WebContents, selectionText: string) => void;

function toItem(entry: MenuEntry, contents: WebContents, at: { x: number; y: number },
  quote: () => void): MenuItemConstructorOptions {
  if (entry.kind === 'separator') return { type: 'separator' };
  if (entry.kind === 'role') return { role: entry.role, label: entry.label, enabled: entry.enabled };
  const base = { label: entry.label, ...(entry.accelerator === undefined ? {}
    : { accelerator: entry.accelerator, registerAccelerator: false }) };
  switch (entry.id) {
    case 'quote': return { ...base, click: quote };
    case 'replaceMisspelling': return { ...base, click: () => contents.replaceMisspelling(entry.value ?? '') };
    case 'copyLink':
    case 'copyImageAddress': return { ...base, click: () => clipboard.writeText(entry.value ?? '') };
    case 'copyImage': return { ...base, click: () => contents.copyImageAt(at.x, at.y) };
  }
}

export function attachContextMenu(contents: WebContents, window: () => BaseWindow, quote: QuoteFromMenu): void {
  contents.on('context-menu', (_event, params) => {
    const entries = contextMenuEntries(params);
    if (entries.length === 0) return;
    const items = entries.map((entry) => toItem(entry, contents, params, () => quote(contents, params.selectionText)));
    Menu.buildFromTemplate(items).popup({ window: window() });
  });
}

export function attachQuoteShortcut(contents: WebContents, platform: NodeJS.Platform, quote: QuoteFromMenu): void {
  contents.on('before-input-event', (event, input) => {
    const command = platform === 'darwin' ? input.meta : input.control;
    if (input.type !== 'keyDown' || !command || !input.shift || input.alt || input.key.toLowerCase() !== 'l') return;
    event.preventDefault();
    void contents.executeJavaScript('String(window.getSelection() ?? "")').then((text: unknown) => {
      if (typeof text === 'string' && text.trim() !== '') quote(contents, text);
    }, () => undefined);
  });
}
