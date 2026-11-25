import { BrowserToolActionSchema } from '../../shared/browser-observation.ts';
import type { BrowserAction } from './transports.ts';
import type { BrowserView } from './browser.ts';
import { defineTool, type Tool } from '../tools/index.ts';
import { browserResult } from './browser-result.ts';

export interface BrowserActor {
  act(action: BrowserAction, signal: AbortSignal, scope?: string, observationId?: string): Promise<BrowserView>;
}
const ACT_TIMEOUT_MS = 20_000;

export function createCloudBrowserActTool(browser: BrowserActor): Tool {
  return defineTool({
    name: 'cloud_browser_act', label: '云端浏览器 · 操作',
    description: '在这件事绑定的云端浏览器标签里点、打字、按键、滚动或跳转。在任务里必须带 cloud_browser_observe 给的 observationId，照看到的标签和坐标做。每做一步再看一次；'
      + '页面过期的在发输入前就会被拒。他接手了就停下这一步。结果不明的，先核实再决定要不要重做。',
    replay: 'once', effect: 'external', permission: 'auto', roles: ['conversation', 'worker'],
    timeoutMs: ACT_TIMEOUT_MS,
    parameters: BrowserToolActionSchema,
    async execute(args, context) {
      return JSON.stringify(await browserResult(() =>
        browser.act(args.action, context.signal, undefined, args.observationId), true));
    },
  });
}
