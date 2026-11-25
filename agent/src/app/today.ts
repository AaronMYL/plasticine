import { UpdateDailySettingsRequestSchema, type TodayNumbers } from '../../shared/api/index.ts';
import type { DailySettingsPatch } from '../../shared/state.ts';
import { requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { settingsView } from './daily-views.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export function todayNumbers(deps: AppDeps, day: string, timeZone: string): TodayNumbers {
  const { state, daily } = deps;
  return {
    feedNew: daily.feed.newToday(timeZone),
    concernsActive: 0,
    concernsPendingClose: 0,
    projectsActive: state.projects.all().filter((project) => project.lifecycle === 'active').length,
    moneyThisMonth: deps.toolGroups.life.money.month(day.slice(0, 7), timeZone).expenseCents,
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
