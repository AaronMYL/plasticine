// life/：日常事务——记账（账本、分类、账户、统计）和付款截图的记账草案。数据只经 state/ 写，不调模型（截图识别在 brain/）。
// 2026-11-05 他定：自建的提醒、日历和专注删掉（Apple 日历和提醒以后由 Mac 接），交互遥测随度量一起删。

import type { StateService } from '../state/index.ts';
import { MoneyDesk } from './money.ts';

export { dayOf } from './periods.ts';
export { MoneyDraftDesk } from './money-drafts.ts';
export { LIFE_ERROR_CODES, LifeError } from './errors.ts';
export type { LifeErrorCode } from './errors.ts';
export { BASE_CURRENCY, DEFAULT_CATEGORIES, MoneyDesk } from './money.ts';
export type {
  AccountBalance,
  AfterCommit,
  Assets,
  DaySummary,
  EntryDraft,
  MonthSummary,
  MoneySink,
  Stats,
} from './money.ts';
export { STAT_RANGES } from './periods.ts';
export type { StatRange } from './periods.ts';

export function createLife(options: { state: StateService; now: () => Date }) {
  const money = new MoneyDesk(options);
  return { money };
}

export type Life = ReturnType<typeof createLife>;
