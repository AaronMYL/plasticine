// 一轮出错后怎么办（模型通道和网络的错，不是工具的错——工具报错原样交回模型）：
// - 额度用完：线进 paused，到错误里给的重置时间再接着跑；没给时间就过一小时再试。
// - 上下文太长：压缩一次再试。
// - 连不上、超时、服务忙：重试 3 次、间隔递增，还不行线进 failed。
// - 其余（登录失效、请求不对）：直接 failed，原因写一句中文给他看。
// 判断「能不能重试」用 pi-ai 自己的 isRetryableAssistantError / isContextOverflow，不另写一套。

import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai';

// 额度错误里没写什么时候恢复时，过这么久再试一次（ChatGPT 订阅额度按小时恢复）。
export const DEFAULT_PAUSE_MS = 60 * 60_000;
// 重试 3 次，间隔递增：2 秒、8 秒、30 秒（一次短暂断网够了，再长就该告诉他）。
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];

const QUOTA_PATTERN = new RegExp([
  'usage.?limit',
  'insufficient_quota',
  'quota exceeded',
  'out of budget',
  'billing',
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_workplace_individual_usage_limit_exceeded',
  'Monthly usage limit reached',
  '"code"\\s*:\\s*"?1308(?![0-9])',
  '额度',
].join('|'), 'i');

const AUTH_PATTERN = /\b401\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|invalid_grant|refresh token|reconnect|login/i;

export type FailureVerdict =
  | { kind: 'quota'; until: Date; reason: string }
  | { kind: 'overflow'; reason: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'fatal'; reason: string };

const RELATIVE_RESET = new RegExp('(?:try again|retry|resets?)\\s*(?:after|in)\\s*~?\\s*(\\d+(?:\\.\\d+)?)\\s*'
  + '(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\\b', 'i');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const SECOND_MS = 1_000;

/** 错误里写的恢复时间：resets_at（秒）、「try again in ~N min」「in N hours」「retry after N seconds」、ISO 时间。 */
export function resetTime(text: string, now: Date): Date | null {
  const epoch = /resets?_?at["'\s:=]+(\d{9,13})/i.exec(text);
  if (epoch?.[1] !== undefined) {
    const value = Number(epoch[1]);
    return new Date(value < 1e12 ? value * SECOND_MS : value);
  }
  const relative = RELATIVE_RESET.exec(text);
  if (relative?.[1] !== undefined && relative[2] !== undefined) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    let scale = SECOND_MS;
    if (unit.startsWith('h')) {
      scale = HOUR_MS;
    } else if (unit.startsWith('m')) {
      scale = MINUTE_MS;
    }
    return new Date(now.getTime() + amount * scale);
  }
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(text);
  if (iso?.[1] !== undefined) {
    const at = new Date(iso[1]);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

/** 一轮以 error 结束时的去向。 */
export function classifyFailure(message: AssistantMessage, now: Date): FailureVerdict {
  const text = message.errorMessage ?? '';
  if (QUOTA_PATTERN.test(text)) {
    const reset = resetTime(text, now);
    const later = reset !== null && reset.getTime() > now.getTime();
    const until = later ? reset : new Date(now.getTime() + DEFAULT_PAUSE_MS);
    return { kind: 'quota', until, reason: '模型额度用完了' };
  }
  if (isContextOverflow(message)) {
    return { kind: 'overflow', reason: '这条线的内容超过了模型一次能读的长度' };
  }
  if (isRetryableAssistantError(message)) {
    return { kind: 'retry', reason: '连不上模型' };
  }
  if (AUTH_PATTERN.test(text)) {
    return { kind: 'fatal', reason: '模型登录失效了：去「设置 · AI」重新连接后点重试' };
  }
  return { kind: 'fatal', reason: '模型这次没有回答（请求被拒了）：点重试，或换个模型' };
}

/** 重试中那一句：「连不上模型，第 2 次重试…」。 */
export function retryingText(reason: string, attempt: number): string {
  return `${reason}，第 ${attempt} 次重试…`;
}

/** 重试用完后那一句：「连不上模型，已重试 3 次」。 */
export function exhaustedText(reason: string, attempts: number): string {
  return `${reason}，已重试 ${attempts} 次`;
}
