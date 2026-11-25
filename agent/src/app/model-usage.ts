import { MODEL_PURPOSES, ModelUsageQuerySchema, type ModelUsageReport, type UsageAmount, type UsageBucket,
  type UsageGroup, type UsageRange } from '../../shared/api/index.ts';
import { isTimeZone } from '../../shared/time-zone.ts';
import { BACKGROUND_TIME_ZONE, dayStartOf, localDay } from '../daily/index.ts';
import type { UsageRow } from '../state/index.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

const DAYS: Readonly<Record<Exclude<UsageRange, 'today'>, number>> = { week: 7, month: 30 };
const HOURS = 24;

const LINE_PURPOSES: Readonly<Record<string, string>> = {
  main: '主线', side: '队友', agent: '后台线', network_reply: '联系人和群代答', other: '其他',
};

export interface UsageNames {
  model(provider: string, model: string): string;
  provider(provider: string): string;
}

function purposeName(purpose: string): string {
  return LINE_PURPOSES[purpose] ?? MODEL_PURPOSES.find((item) => item.id === purpose)?.label ?? purpose;
}

function emptyAmount(): UsageAmount {
  return { requests: 0, input: 0, cacheRead: 0, output: 0, cost: 0, priced: false };
}

function add(amount: UsageAmount, row: UsageRow): void {
  amount.requests += 1;
  amount.input += row.input + row.cacheRead + row.cacheWrite;
  amount.cacheRead += row.cacheRead;
  amount.output += row.output;
  amount.cost += row.cost;
  amount.priced ||= row.cost > 0;
}

function rounded(amount: UsageAmount): UsageAmount {
  return { ...amount, cost: Math.round(amount.cost * 100) / 100 };
}

function shiftDay(day: string, by: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + by)).toISOString().slice(0, 10);
}

function hourIn(timeZone: string): (instant: Date) => number {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return (instant) => Number(format.format(instant)) % HOURS;
}

export function usageWindow(range: UsageRange, timeZone: string, now: Date)
  : { since: string; buckets: { key: string; label: string; start: string }[] } {
  const today = localDay(now, timeZone);
  if (range === 'today') {
    const start = dayStartOf(today, timeZone);
    return { since: start.toISOString(), buckets: Array.from({ length: HOURS }, (_unused, hour) => ({
      key: String(hour), label: String(hour).padStart(2, '0'),
      start: new Date(start.getTime() + hour * 3_600_000).toISOString() })) };
  }
  const days = Array.from({ length: DAYS[range] }, (_unused, index) => shiftDay(today, index - DAYS[range] + 1));
  return { since: dayStartOf(days[0] ?? today, timeZone).toISOString(), buckets: days.map((day) => ({
    key: day, label: day.slice(5), start: dayStartOf(day, timeZone).toISOString() })) };
}

export function usageReport(rows: readonly UsageRow[], range: UsageRange, timeZone: string, now: Date,
  names: UsageNames): ModelUsageReport {
  const window = usageWindow(range, timeZone, now);
  const today = localDay(now, timeZone);
  const hour = hourIn(timeZone);
  const total = emptyAmount();
  const buckets = new Map(window.buckets.map((bucket) => [bucket.key, emptyAmount()]));
  const models = new Map<string, { group: UsageGroup; lines: Set<string> }>();
  const purposes = new Map<string, { group: UsageGroup; lines: Set<string> }>();
  const groupOf = (map: typeof models, key: string, make: () => UsageGroup) => {
    let found = map.get(key);
    if (found === undefined) {
      found = { group: make(), lines: new Set() };
      map.set(key, found);
    }
    return found;
  };
  for (const row of rows) {
    if (row.at < window.since) {
      continue;
    }
    const instant = new Date(row.at);
    const day = localDay(instant, timeZone);
    const key = range === 'today' ? (day === today ? String(hour(instant)) : null) : day;
    const bucket = key === null ? undefined : buckets.get(key);
    if (bucket === undefined) {
      continue;
    }
    add(bucket, row);
    add(total, row);
    const model = groupOf(models, `${row.provider}/${row.model}`, () => ({ key: `${row.provider}/${row.model}`,
      name: names.model(row.provider, row.model), provider: names.provider(row.provider), amount: emptyAmount() }));
    add(model.group.amount, row);
    const purpose = groupOf(purposes, row.purpose, () => ({ key: row.purpose, name: purposeName(row.purpose),
      amount: emptyAmount() }));
    add(purpose.group.amount, row);
    if (row.lineId !== null && LINE_PURPOSES[row.purpose] !== undefined) {
      purpose.lines.add(row.lineId);
    }
  }
  const sorted = (map: typeof models): UsageGroup[] => [...map.values()]
    .map(({ group, lines }) => ({ ...group, ...(lines.size === 0 ? {} : { lines: lines.size }),
      amount: rounded(group.amount) }))
    .sort((a, b) => (b.amount.input + b.amount.output) - (a.amount.input + a.amount.output));
  const bucketList: UsageBucket[] = window.buckets.map((bucket) => ({ label: bucket.label, start: bucket.start,
    amount: rounded(buckets.get(bucket.key) ?? emptyAmount()) }));
  return { range, timeZone, total: rounded(total), buckets: bucketList, byModel: sorted(models),
    byPurpose: sorted(purposes) };
}

function namesFrom(context: RequestContext): UsageNames {
  const providers = context.deps.kernelModels?.models.providers() ?? [];
  return {
    model: (provider, model) => providers.find((item) => item.id === provider)?.models
      .find((item) => item.id === model)?.name ?? model,
    provider: (provider) => providers.find((item) => item.id === provider)?.name ?? provider,
  };
}

/** GET /v2/model-providers/usage */
export function getModelUsage(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(ModelUsageQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const { state } = context.deps;
  const asked = query.tz !== undefined && isTimeZone(query.tz) ? query.tz : undefined;
  const timeZone = asked ?? state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE;
  const range = query.range ?? 'week';
  const now = context.deps.now();
  const since = usageWindow(range, timeZone, now).since;
  return { status: 200, body: usageReport(state.modelCalls.usageSince(since), range, timeZone, now,
    namesFrom(context)) };
}
