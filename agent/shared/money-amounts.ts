import type { MoneyEntry } from './state-life.ts';

export function moneyAmounts(entry: Pick<MoneyEntry, 'kind' | 'cnyCents' | 'feeCents'>): {
  income: number;
  expense: number;
  transfer: number;
} {
  let expense = entry.feeCents ?? 0;
  if (entry.kind === 'expense') {
    expense += entry.cnyCents;
  } else if (entry.kind === 'refund') {
    expense -= entry.cnyCents;
  }
  return {
    income: entry.kind === 'income' ? entry.cnyCents : 0,
    expense,
    transfer: entry.kind === 'transfer' ? entry.cnyCents : 0,
  };
}
