import type { PageOperateEvent, PageStepStatus } from '../api/shared.ts';
import { Store } from './store.ts';

export const PAGE_STEPS_MAX = 6;
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

  recent(tabId: string, now: Date = new Date(), steps: StepsByTab = this.store.get()): readonly PageStep[] {
    const list = steps[tabId] ?? [];
    const last = list.at(-1);
    if (last === undefined || now.getTime() - Date.parse(last.at) > PAGE_STEPS_IDLE_MS) {
      return [];
    }
    return list;
  }
}
