import type { WidgetFacts } from '../tools/index.ts';
import { dayOf, type Life } from '../life/index.ts';
import type { StateService } from '../state/index.ts';

const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

function userTimeZone(state: StateService): string {
  return state.dailySettings.read().settings.timeZone ?? FALLBACK_TIME_ZONE;
}

export function createWidgetFacts(state: StateService, life: Life): WidgetFacts {
  return {
    moneyCategories: () => life.money.categories().filter((category) => category.kind === 'expense')
      .map((category) => category.name),
    monthCategoryCents(category, occurredAt, amountCents) {
      const found = life.money.categories().find((item) => item.name === category && item.kind === 'expense');
      if (found === undefined) {
        return null;
      }
      const timeZone = userTimeZone(state);
      const month = dayOf(occurredAt, timeZone).slice(0, 7);
      const spent = life.money.month(month, timeZone).days.flatMap((day) => day.entries)
        .filter((entry) => entry.kind === 'expense' && entry.categoryId === found.id)
        .reduce((sum, entry) => sum + entry.cnyCents, 0);
      return spent + amountCents;
    },
  };
}
