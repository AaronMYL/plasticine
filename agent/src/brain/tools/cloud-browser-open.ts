// cloud_browser_open：在共享浏览器当前标签导航，HTTP/HTTPS 地址经 cleanUrl。用户随时可以接手。

import { BrowserNavigationSchema } from '../../../shared/api/index.ts';
import type { BrowserView } from '../../cloud-tools/index.ts';
import { defineTool, type Tool } from './registry.ts';
import { browserResult } from './browser-result.ts';

export interface BrowserOpener {
  open(url: string, signal: AbortSignal, scope?: string): Promise<BrowserView>;
}

// 开一个页面最多等 30 秒。
const OPEN_TIMEOUT_MS = 30_000;

export const CloudBrowserOpenParameters = BrowserNavigationSchema;

export function createCloudBrowserOpenTool(browser: BrowserOpener): Tool {
  return defineTool({
    name: 'cloud_browser_open',
    label: '云端浏览器 · 打开',
    description:
      'Opens an http or https address in the server browser, binding a separate tab to the task. '
      + 'The user sees it and can take over. Use cloud_browser_observe to inspect the actual page before acting.',
    replay: 'safe',
    effect: 'read',
    permission: 'auto',
    roles: ['conversation', 'worker'],
    timeoutMs: OPEN_TIMEOUT_MS,
    parameters: CloudBrowserOpenParameters,
    async execute(args, context) {
      return JSON.stringify(await browserResult(() => browser.open(args.url, context.signal, undefined)));
    },
  });
}
