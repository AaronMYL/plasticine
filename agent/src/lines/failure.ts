import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai';
import { safeLog, type ErrorCategory } from '../util/index.ts';

export const DEFAULT_PAUSE_MS = 60 * 60_000;
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];
const MODEL_ERROR_MAX_CHARS = 240;

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

export function retryingText(reason: string, attempt: number): string {
  return `${reason}，第 ${attempt} 次重试…`;
}

export function exhaustedText(reason: string, attempts: number): string {
  return `${reason}，已重试 ${attempts} 次`;
}

export function sanitizeModelError(raw: string): string {
  const scrubbed = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.length > MODEL_ERROR_MAX_CHARS ? `${scrubbed.slice(0, MODEL_ERROR_MAX_CHARS)}…` : scrubbed;
}

function httpStatus(text: string): number | null {
  const match = /(?:^|\b(?:status(?: code)?|HTTP)\s*)(\d{3})\b/i.exec(text);
  const code = match?.[1] === undefined ? null : Number(match[1]);
  return code !== null && code >= 100 && code <= 599 ? code : null;
}

function failureCategory(verdict: FailureVerdict): ErrorCategory {
  if (verdict.kind === 'quota') {
    return 'quota';
  }
  if (verdict.kind === 'overflow') {
    return 'context_overflow';
  }
  if (verdict.kind === 'retry') {
    return 'network';
  }
  return verdict.reason.startsWith('模型登录失效') ? 'auth' : 'unknown';
}

export function logModelFailure(message: AssistantMessage, verdict: FailureVerdict): void {
  const raw = message.errorMessage ?? '';
  const status = httpStatus(raw);
  safeLog('warn', 'model_call_failed', {
    category: failureCategory(verdict),
    stepKey: `${message.provider}/${message.model}`,
    ...(status === null ? {} : { status }),
    error: sanitizeModelError(raw),
  });
}
