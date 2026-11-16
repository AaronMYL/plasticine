// 云端浏览器的标签（11-16）：以前 AI 看不到云端浏览器开着哪些标签、也关不了，一个标签空转了两天。
// cloud_browser_tabs 列出开着的标签；cloud_browser_close 关一个。都是 Plasticine 自己的浏览器，不用问他。

import { Type } from 'typebox';
import type { BrowserTabAction } from '../../shared/api/browser.ts';
import { defineTool, type Tool } from '../tools/index.ts';
import type { BrowserView } from './browser.ts';

export interface BrowserTabsPort {
  refresh(signal: AbortSignal): Promise<BrowserView>;
  tab(action: BrowserTabAction, signal: AbortSignal): Promise<BrowserView>;
}

const TIMEOUT_MS = 20_000;

function tabsOf(view: BrowserView) {
  return { activeTabId: view.activeTabId ?? null, tabs: (view.tabs ?? []).map((tab) => ({ tabId: tab.id,
    url: tab.url, title: tab.title })) };
}

export function createCloudBrowserTabsTools(browser: BrowserTabsPort): Tool[] {
  return [
    defineTool({ name: 'cloud_browser_tabs', label: '云端浏览器 · 标签',
      description: '列出云端浏览器开着的标签（标签 id、网址、标题、哪个在前面）。'
        + '做完的、重复的、卡住的标签用 cloud_browser_close 关掉。',
      parameters: Type.Object({}, { additionalProperties: false }),
      replay: 'safe', effect: 'read', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: TIMEOUT_MS,
      async execute(_args, context) {
        return JSON.stringify(tabsOf(await browser.refresh(context.signal)));
      } }),
    defineTool({ name: 'cloud_browser_close', label: '云端浏览器 · 关标签',
      description: '关掉云端浏览器里的一个标签（cloud_browser_tabs 给的 id）。只影响 Plasticine 自己的浏览器。',
      parameters: Type.Object({ tabId: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false }),
      replay: 'safe', effect: 'internal', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: TIMEOUT_MS,
      async execute(args, context) {
        return JSON.stringify(tabsOf(await browser.tab({ kind: 'close', tabId: args.tabId }, context.signal)));
      } }),
  ];
}
