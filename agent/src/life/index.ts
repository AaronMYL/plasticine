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
export { PaymentReader } from './payment-reader.ts';
export { createPaymentTool } from './payment-tool.ts';
