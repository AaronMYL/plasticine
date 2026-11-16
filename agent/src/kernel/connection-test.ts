// 测试连接（11-16 Aaron：「支持测试连接，验证配置是否可用，并展示具体错误原因」）：用表单里还没保存的配置试两步——
//   1. 读模型列表：直接发 HTTP，连不上、证书、key 不对、地址不对这些在这一步说得最清楚；
//   2. 让模型回一句：和真正用的时候一样经 pi-ai 发（同一套协议实现和兼容设置），能回就说明保存以后能用。
// 连不上或 key 不对时第二步不跑（结果一样，只是多等）。

import { createModels, InMemoryCredentialStore, type AssistantMessage, type AuthContext }
  from '@earendil-works/pi-ai';
import { CONNECTION_TEST_TIMEOUT_MS, type ConnectionTestStep, type CustomProtocol,
  type TestModelConnectionResponse } from '../../shared/api/custom-providers.ts';
import { customProvider, sdkBaseUrl } from './custom-providers.ts';

const DETAIL_MAX = 400;
const MAX_LISTED = 500;
const REPLY_MAX_TOKENS = 64;
const TEST_PROVIDER_ID = 'custom-connection-test';

const STORED_ONLY: AuthContext = { env: async () => undefined, fileExists: async () => false };

export interface ConnectionTestInput {
  protocol: CustomProtocol;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface ConnectionTestDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const NETWORK_REASONS: readonly [RegExp, string][] = [
  [/ENOTFOUND|EAI_AGAIN/, '找不到这个域名，检查 Base URL 有没有拼错'],
  [/ECONNREFUSED/, '对方拒绝连接：端口没开或服务没启动'],
  [/ECONNRESET|UND_ERR_SOCKET|other side closed/, '连接被对方断开了'],
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/, 'HTTPS 证书有问题'],
  [/TIMEOUT|TimeoutError|timed out/i, '连了很久没有回应'],
];

function causeText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code: unknown = Reflect.get(current, 'code');
    parts.push(typeof code === 'string' ? `${code} ${current.message}` : `${current.name}: ${current.message}`);
    current = current.cause;
  }
  return parts.join(' ← ') || String(error);
}

function networkReason(text: string): string {
  return NETWORK_REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? '连不上接口';
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat;
}

/** 服务端回的错误：JSON 里的 error.message / message，网页只说是网页，其余截一段原文。 */
function bodyDetail(body: string): string | null {
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

function step(name: ConnectionTestStep['step'], ok: boolean, summary: string, extra: { detail?: string | null;
  status?: number | null; latencyMs: number }): ConnectionTestStep {
  return { step: name, ok, summary, detail: extra.detail ?? null, status: extra.status ?? null,
    latencyMs: Math.max(0, Math.round(extra.latencyMs)) };
}

function withStatus(summary: string, status: number | null): string {
  return status === null ? summary : `${summary}（${String(status)}）`;
}

function listedModels(body: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const data: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'data') : undefined;
    if (!Array.isArray(data)) return null;
    const ids = data.flatMap((item: unknown) => {
      const id: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'id') : undefined;
      return typeof id === 'string' && id !== '' ? [id] : [];
    });
    return [...new Set(ids)].slice(0, MAX_LISTED);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function listHeaders(protocol: CustomProtocol, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`;
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey !== '') headers['x-api-key'] = apiKey;
  }
  return headers;
}

interface ListOutcome {
  step: ConnectionTestStep;
  models: string[] | null;
  /** 连不上或 key 不对：后面不用试了。 */
  fatal: boolean;
}

async function listStep(input: ConnectionTestInput, fetcher: typeof fetch, signal: AbortSignal,
  now: () => number): Promise<ListOutcome> {
  const base = sdkBaseUrl(input.protocol, input.baseUrl);
  const url = input.protocol === 'anthropic-messages' ? `${base}/v1/models` : `${base}/models`;
  const started = now();
  let response: Response;
  let body: string;
  try {
    response = await fetcher(url, { headers: listHeaders(input.protocol, input.apiKey), signal });
    body = await response.text();
  } catch (error) {
    const text = signal.aborted ? `TimeoutError ${causeText(error)}` : causeText(error);
    return { step: step('models', false, networkReason(text), { detail: clip(text), latencyMs: now() - started }),
      models: null, fatal: true };
  }
  const latencyMs = now() - started;
  const detail = bodyDetail(body);
  if (!response.ok) {
    const fatal = response.status === 401 || response.status === 403;
    const summary = response.status === 404 ? '这个地址没有模型列表' : statusReason(response.status, detail);
    return { step: step('models', false, withStatus(summary, response.status),
      { detail, status: response.status, latencyMs }), models: null, fatal };
  }
  const models = listedModels(body);
  if (models === null) {
    return { step: step('models', false, '模型列表读不懂：检查 Base URL', { detail, status: response.status,
      latencyMs }), models: null, fatal: false };
  }
  return { step: step('models', true, `接口列出 ${String(models.length)} 个模型`, { status: response.status,
    latencyMs }), models, fatal: false };
}

function replyText(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
}

function errorStatus(message: string): number | null {
  const match = /(?:^|\b(?:status(?: code)?|HTTP)\s*)(\d{3})\b/i.exec(message);
  return match?.[1] === undefined ? null : Number(match[1]);
}

async function replyStep(input: ConnectionTestInput & { model: string }, fetcher: typeof fetch,
  signal: AbortSignal, now: () => number): Promise<ConnectionTestStep> {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(TEST_PROVIDER_ID, async () => ({ type: 'api_key', key: input.apiKey }));
  const models = createModels({ credentials, authContext: STORED_ONLY, identity: { attribution: null } });
  models.setProvider(customProvider({ id: TEST_PROVIDER_ID, name: '测试', protocol: input.protocol,
    baseUrl: input.baseUrl, models: [input.model] }));
  const model = models.getModel(TEST_PROVIDER_ID, input.model);
  const started = now();
  if (model === undefined) throw new Error('测试用的模型没装上');
  const answer = await models.completeSimple(model,
    { messages: [{ role: 'user', content: '只回复 pong 这一个词。', timestamp: Date.now() }] },
    { signal, maxTokens: REPLY_MAX_TOKENS, fetch: fetcher });
  const latencyMs = now() - started;
  if (answer.stopReason === 'error' || answer.stopReason === 'aborted') {
    const raw = answer.errorMessage ?? '没有说原因';
    const status = errorStatus(raw);
    // pi-ai 写成「401: {"error":…}」或「401 Incorrect API key…」：去掉状态码再取服务端的话。
    const detail = bodyDetail(raw.replace(/^\d{3}:?\s*/, '')) ?? clip(raw);
    const summary = signal.aborted ? '连了很久没有回应'
      : status === null ? networkReason(raw) : statusReason(status, detail, input.model);
    return step('reply', false, withStatus(summary, status), { detail, status, latencyMs });
  }
  const text = replyText(answer);
  return step('reply', true, `${input.model} 回复了`, { detail: text === '' ? null : clip(text), latencyMs });
}

export async function testConnection(input: ConnectionTestInput, deps: ConnectionTestDeps = {},
  outer?: AbortSignal): Promise<TestModelConnectionResponse> {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => performance.now());
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS);
  const listed = await listStep(input, fetcher, outer === undefined ? timeout : AbortSignal.any([outer, timeout]),
    now);
  if (listed.fatal || input.model === undefined) {
    return { ok: listed.step.ok, steps: [listed.step], models: listed.models };
  }
  const replyTimeout = AbortSignal.timeout(deps.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS);
  const reply = await replyStep({ ...input, model: input.model }, fetcher,
    outer === undefined ? replyTimeout : AbortSignal.any([outer, replyTimeout]), now);
  return { ok: reply.ok, steps: [listed.step, reply], models: listed.models };
}
