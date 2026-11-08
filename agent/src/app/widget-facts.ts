// show_widgets 补对照数要读的东西（brain/tools/show-widgets.ts 的 WidgetFacts），用 life/ 和 state/ 实现；只读。
// 时区按用户在设置里定的（没定是 Asia/Shanghai），和记账页算「本月」用同一个。

import type { WidgetFacts } from '../brain/index.ts';
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
