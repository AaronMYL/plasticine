// 脑与用户共用操作 schema；对外动作按工具回执干跑。第 97 条（10-29）起不再逐次批准：原来的批准入口从没接上，
// 你点了批准也执行不了。
import { BrowserActionInputSchema } from '../../../shared/api/index.ts';
import { BrowserToolActionSchema } from '../../../shared/browser-observation.ts';
import type { BrowserAction, BrowserView } from '../../cloud-tools/index.ts';
import { defineTool, type Tool } from './registry.ts';
import { browserResult } from './browser-result.ts';

export interface BrowserActor {
  act(action: BrowserAction, signal: AbortSignal, scope?: string, observationId?: string): Promise<BrowserView>;
}
const ACT_TIMEOUT_MS = 20_000;
export const BrowserActionSchema = BrowserActionInputSchema;

export function createCloudBrowserActTool(browser: BrowserActor): Tool {
  return defineTool({
    name: 'cloud_browser_act', label: '云端浏览器 · 操作',
    description: 'Clicks, types, presses keys, scrolls or navigates the task-bound browser tab. '
      + 'In a task, observationId from cloud_browser_observe is required: use the observed labels and coordinates. '
      + 'Observe again after every action; stale pages are rejected before input is sent. '
      + 'If the user takes over, stop this step. An unknown result must be verified before any repeat.',
    replay: 'once', effect: 'external', permission: 'auto', roles: ['conversation', 'worker'],
    timeoutMs: ACT_TIMEOUT_MS,
    parameters: BrowserToolActionSchema,
    async execute(args, context) {
      return JSON.stringify(await browserResult(() =>
        browser.act(args.action, context.signal, undefined, args.observationId), true));
    },
  });
}
