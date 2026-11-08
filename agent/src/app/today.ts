// /v2/today/settings（shared/api/today.ts）：每日设置（时区、信息流这几样）。按 requestId 幂等。
// 2026-11-05 Harness 重做：回来四句话、十件事的接口删掉，首页（home.ts）给今天的数。

import { UpdateDailySettingsRequestSchema, type TodayNumbers } from '../../shared/api/index.ts';
import type { DailySettingsPatch } from '../../shared/state.ts';
import { requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { settingsView } from './daily-views.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

/**
 * 首页最底下一行今天的数：新到的信息流、在进行的项目、这个月花了多少。关切、日程、专注随功能删掉，给 0 或 null
 * （字段留给旧客户端，shared/api/today.ts 里标着待客户端切完后删）。
 */
export function todayNumbers(deps: AppDeps, day: string, timeZone: string): TodayNumbers {
  const { state, daily } = deps;
  return {
    feedNew: daily.feed.newToday(timeZone),
    concernsActive: 0,
    concernsPendingClose: 0,
    projectsActive: state.projects.all().filter((project) => project.lifecycle === 'active').length,
    moneyThisMonth: deps.m5b.life.money.month(day.slice(0, 7), timeZone).expenseCents,
    calendarToday: null,
    focusMinutesToday: null,
  };
}

/** GET /v2/today/settings */
export function getDailySettings(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: settingsView(context.deps.state.dailySettings.read()) };
}

/** PUT /v2/today/settings */
export async function updateDailySettings(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(UpdateDailySettingsRequestSchema, await readJsonBody(context.req), '每日设置');
  const { deps } = context;
  return idempotent(context, body.requestId, () => {
    const { requestId: _requestId, version, ...changes } = body;
    const patch: DailySettingsPatch = changes;
    return { status: 200, body: settingsView(deps.state.dailySettings.save(version, patch)) };
  });
}
