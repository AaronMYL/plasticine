// 假的 AI 用量（11-18）：固定的一组数，够看出今天按小时、7 天和 30 天按天、按模型和按用途的样子。

import type { ModelUsageApi } from '../model-usage-client.ts';
import type { ModelUsageReport, UsageAmount, UsageGroup, UsageRange } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

const MILLION = 1_000_000;
/** 每天、每小时用掉的 token（百万）和请求次数。 */
const DAY_TOKENS = [0, 0, 0, 0, 0, 0, 0, 0, 2.1, 9.4, 14.2, 6.8, 3.1, 0.4, 0.2, 63.9, 8, 5.7, 8.6, 18.2, 12.5, 31.4,
  25.6, 7, 6.9, 13.3, 13.7, 70.1, 188.7, 12];
const DAY_REQUESTS = [0, 0, 0, 0, 0, 0, 0, 0, 31, 120, 188, 74, 41, 4, 5, 802, 75, 117, 178, 301, 196, 536, 244, 59,
  84, 203, 146, 832, 1303, 258];
const HOUR_TOKENS = [0.1, 0, 0, 0, 0, 0, 0.3, 0.9, 1.4, 2.2, 1.6, 0.8, 0.2, 0.4, 1.1, 1.6, 0.9, 0.5, 0, 0, 0, 0, 0, 0];
const HOUR_REQUESTS = [2, 0, 0, 0, 0, 0, 7, 19, 31, 48, 35, 17, 5, 9, 24, 33, 20, 8, 0, 0, 0, 0, 0, 0];
/** 估的价：一百万 token 两美元出头（大多是缓存读）。 */
const PRICE = 2.2;

function amount(millions: number, requests: number, priced = true): UsageAmount {
  const tokens = Math.round(millions * MILLION);
  const output = Math.round(tokens * 0.002);
  return { requests, input: tokens - output, cacheRead: Math.round((tokens - output) * 0.92), output,
    cost: priced ? Math.round(millions * PRICE * 100) / 100 : 0, priced };
}

function dayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit', day: '2-digit' }).format(instant);
}

function split(total: UsageAmount, shares: readonly [string, string, number, (string | undefined)?, number?][],
  provider: boolean)
  : UsageGroup[] {
  return shares.map(([key, name, share, owner, lines]) => {
    const part = amount((total.input + total.output) * share / MILLION, Math.round(total.requests * share),
      owner !== 'monk.party');
    return { key, name, ...(provider && owner !== undefined ? { provider: owner } : {}),
      ...(lines === undefined ? {} : { lines }), amount: part };
  });
}

export class FakeModelUsage implements ModelUsageApi {
  private readonly session: FakeSession;
  private readonly now: () => Date;

  constructor(session: FakeSession, now: () => Date) {
    this.session = session;
    this.now = now;
  }

  async report(range: UsageRange, timeZone: string): Promise<ModelUsageReport> {
    this.session.require();
    const now = this.now();
    const days = range === 'week' ? 7 : 30;
    const buckets = range === 'today'
      ? HOUR_TOKENS.map((tokens, hour) => ({ label: String(hour).padStart(2, '0'), start: now.toISOString(),
        amount: amount(tokens, HOUR_REQUESTS[hour] ?? 0) }))
      : DAY_TOKENS.slice(-days).map((tokens, index) => {
        const instant = new Date(now.getTime() - (days - 1 - index) * 86_400_000);
        return { label: dayLabel(instant, timeZone), start: instant.toISOString(),
          amount: amount(tokens, DAY_REQUESTS.slice(-days)[index] ?? 0) };
      });
    const total = buckets.reduce((sum, bucket) => ({ requests: sum.requests + bucket.amount.requests,
      input: sum.input + bucket.amount.input, cacheRead: sum.cacheRead + bucket.amount.cacheRead,
      output: sum.output + bucket.amount.output, cost: Math.round((sum.cost + bucket.amount.cost) * 100) / 100,
      priced: true }), amount(0, 0));
    return {
      range, timeZone, total, buckets,
      byModel: split(total, [['openai/gpt-6-astra', 'GPT-6 Astra', 0.87, 'OpenAI'],
        ['openai/gpt-6.1-terra', 'GPT-6.1 Terra', 0.1, 'OpenAI'], ['openai/gpt-6.1-sol', 'GPT-6.1 Sol', 0.03, 'OpenAI'],
        ['custom/monk-opus', 'monk-opus', 0.004, 'monk.party']], true),
      byPurpose: split(total, [['agent', '后台线', 0.77, undefined, 41], ['main', '主线', 0.21, undefined, 1],
        ['side', '队友', 0.006, undefined, 3], ['memory_curate', '对话记忆整理', 0.003],
        ['note_predict', '续写', 0.001]], false),
    };
  }
}
