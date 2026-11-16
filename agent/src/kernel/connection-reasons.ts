// 测试连接的几句结论（connection-test.ts、connection-reply.ts 共用）：连不上是哪种、HTTP 状态码说成一句话、
// 服务端原话截一段。

import type { ConnectionTestStep } from '../../shared/api/custom-providers.ts';

const DETAIL_MAX = 400;

const NETWORK_REASONS: readonly [RegExp, string][] = [
  [/ENOTFOUND|EAI_AGAIN/, '找不到这个域名，检查 Base URL 有没有拼错'],
  [/ECONNREFUSED/, '对方拒绝连接：端口没开或服务没启动'],
  [/ECONNRESET|UND_ERR_SOCKET|other side closed/, '连接被对方断开了'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/, 'HTTPS 证书有问题'],
  [/TIMEOUT|TimeoutError|timed out/i, '连了很久没有回应'],
];

export function causeText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code: unknown = Reflect.get(current, 'code');
    parts.push(typeof code === 'string' ? `${code} ${current.message}` : `${current.name}: ${current.message}`);
    current = current.cause;
  }
  return parts.join(' ← ') || String(error);
}

export function networkReason(text: string): string {
  return NETWORK_REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? '连不上接口';
}

export function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat;
}

/** 服务端回的错误：JSON 里的 error.message / message，网页只说是网页，其余截一段原文。 */
export function bodyDetail(body: string): string | null {
  if (body.trim() === '') return null;
  if (/^\s*<(!doctype|html)/i.test(body)) return '返回的是一个网页，不是接口';
  try {
    const parsed: unknown = JSON.parse(body);
    const error: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'error') : undefined;
    const nested: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : error;
    const message: unknown = nested ?? (typeof parsed === 'object' && parsed !== null
      ? Reflect.get(parsed, 'message') : undefined);
    return clip(typeof message === 'string' ? message : body);
  } catch (error) {
    if (error instanceof SyntaxError) return clip(body);
    throw error;
  }
}

/** HTTP 状态码说成一句话。 */
export function statusReason(status: number, detail: string | null, model?: string): string {
  const aboutModel = model !== undefined && detail !== null && /model/i.test(detail);
  if ((status === 404 || status === 400) && aboutModel) return `模型名不对：接口说没有「${model}」`;
  if (status === 401) return 'API Key 不对';
  if (status === 403) return 'API Key 没有权限';
  if (status === 404) return '地址不对：检查 Base URL 结尾要不要带 /v1';
  if (status === 429) return '被限流或额度用完了';
  if (status >= 500) return '接口那边出错了';
  return '请求没成功';
}

export function step(name: ConnectionTestStep['step'], ok: boolean, summary: string, extra: { detail?: string | null;
  status?: number | null; latencyMs: number; model?: string }): ConnectionTestStep {
  return { step: name, model: extra.model ?? null, ok, summary, detail: extra.detail ?? null,
    status: extra.status ?? null, latencyMs: Math.max(0, Math.round(extra.latencyMs)) };
}

export function withStatus(summary: string, status: number | null): string {
  return status === null ? summary : `${summary}（${String(status)}）`;
}

/** pi-ai 的错误写成「401: {"error":…}」「401 Incorrect API key…」「status code 400」：取出状态码。 */
export function errorStatus(message: string): number | null {
  const match = /(?:^|\b(?:status(?: code)?|HTTP)\s*)(\d{3})\b/i.exec(message);
  return match?.[1] === undefined ? null : Number(match[1]);
}
