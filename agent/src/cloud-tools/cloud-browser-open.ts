import { BrowserNavigationSchema } from '../../shared/api/index.ts';
import type { BrowserView } from './browser.ts';
import { defineTool, type Tool } from '../tools/index.ts';
import { browserResult } from './browser-result.ts';

export interface BrowserOpener {
  open(url: string, signal: AbortSignal, scope?: string): Promise<BrowserView>;
}

const OPEN_TIMEOUT_MS = 30_000;

export const CloudBrowserOpenParameters = BrowserNavigationSchema;

export function createCloudBrowserOpenTool(browser: BrowserOpener): Tool {
  return defineTool({
    name: 'cloud_browser_open',
    label: '云端浏览器 · 打开',
    description: '在服务器上的浏览器里打开一个 http 或 https 网址，给这件事单独绑一个标签。他看得到、也能接手。动手前先用 cloud_browser_observe 看真实页面；用完的标签用'
      + ' cloud_browser_close 关掉。',
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
