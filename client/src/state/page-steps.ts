// Plasticine 在网页上做过的步（2026-11-04 第 3 批，他定：他看得到 Plasticine 在点哪——页面上一个 --run 光点跟着动作走，
// 对话框里列出做过的步，状态符 + 一句）。Mac 每做一步经 __plasticineWebTabEvent 报 operate（page-operate.ts 的
// PageOperateEvent），这里按标签记下来；对话框读当前标签的最近几步。只在内存里：换设备、重开 App 不留。

import type { PageOperateEvent, PageStepStatus } from '../api/shared.ts';
import { Store } from './store.ts';

/** 对话框里最多列这么多步：再多是在翻历史，看任务详情。 */
export const PAGE_STEPS_MAX = 6;
/** 最后一步过去这么久就不再列（这一次操作结束了）：10 分钟。 */
export const PAGE_STEPS_IDLE_MS = 10 * 60_000;

export interface PageStep {
  actionId: string;
  status: PageStepStatus;
  text: string;
  at: string;
}

type StepsByTab = Readonly<Record<string, readonly PageStep[]>>;

export class PageSteps {
  readonly store = new Store<StepsByTab>({});

  apply(event: PageOperateEvent, now: Date = new Date()): void {
    const step: PageStep = { actionId: event.actionId, status: event.status, text: event.step, at: now.toISOString() };
    this.store.set((previous) => {
      const list = previous[event.tabId] ?? [];
      const index = list.findIndex((item) => item.actionId === event.actionId);
      const next = index === -1 ? [...list, step] : list.map((item, at) => (at === index ? step : item));
      return { ...previous, [event.tabId]: next.slice(-PAGE_STEPS_MAX) };
    });
  }

  /** 这个标签最近的几步，按先后；最后一步过去太久就是空的。 */
  recent(tabId: string, now: Date = new Date(), steps: StepsByTab = this.store.get()): readonly PageStep[] {
    const list = steps[tabId] ?? [];
    const last = list.at(-1);
    if (last === undefined || now.getTime() - Date.parse(last.at) > PAGE_STEPS_IDLE_MS) {
      return [];
    }
    return list;
  }
}
