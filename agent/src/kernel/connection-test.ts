// 测试连接（11-16 Aaron：「支持测试连接，验证配置是否可用，并展示具体错误原因」）：用表单里还没保存的配置试两步——
//   1. 读模型列表：直接发 HTTP，连不上、证书、key 不对、地址不对这些在这一步说得最清楚；
//   2. 每个模型回一句（connection-reply.ts）：和真正用的时候一样经 pi-ai 发，同时发，能回就说明保存以后能用。
// 连不上或 key 不对时第二步不跑（结果一样，只是多等）。

import { CONNECTION_TEST_TIMEOUT_MS, MAX_TESTED_MODELS, type ConnectionTestStep, type CustomModel,
  type CustomProtocol, type TestModelConnectionResponse } from '../../shared/api/custom-providers.ts';
import { bodyDetail, causeText, clip, networkReason, statusReason, step, withStatus } from './connection-reasons.ts';
import { replyStep } from './connection-reply.ts';
import { sdkBaseUrl } from './custom-providers.ts';

export { statusReason } from './connection-reasons.ts';

const MAX_LISTED = 500;
/** 列表里认得出的上下文长度字段（OpenRouter 这类网关会给）。 */
const CONTEXT_FIELDS = ['context_length', 'context_window', 'max_context_length', 'max_model_len'];

export interface ConnectionTestInput {
  protocol: CustomProtocol;
  baseUrl: string;
  apiKey: string;
  models?: CustomModel[];
}

export interface ConnectionTestDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

type Listed = NonNullable<TestModelConnectionResponse['models']>;

function contextOf(item: object): number | null {
  for (const field of CONTEXT_FIELDS) {
    const value: unknown = Reflect.get(item, field);
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1_000) return value;
  }
  return null;
}

function listedModels(body: string): Listed | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const data: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'data') : undefined;
    if (!Array.isArray(data)) return null;
    const seen = new Set<string>();
    return data.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const id: unknown = Reflect.get(item, 'id');
      if (typeof id !== 'string' || id === '' || seen.has(id)) return [];
      seen.add(id);
      return [{ id, contextWindow: contextOf(item) }];
    }).slice(0, MAX_LISTED);
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
  models: Listed | null;
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

function timed(ms: number, outer: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return outer === undefined ? timeout : AbortSignal.any([outer, timeout]);
}

export async function testConnection(input: ConnectionTestInput, deps: ConnectionTestDeps = {},
  outer?: AbortSignal): Promise<TestModelConnectionResponse> {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => performance.now());
  const ms = deps.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS;
  const listed = await listStep(input, fetcher, timed(ms, outer), now);
  const tested = (input.models ?? []).slice(0, MAX_TESTED_MODELS);
  if (listed.fatal || tested.length === 0) {
    return { ok: listed.step.ok, steps: [listed.step], models: listed.models };
  }
  const context = { fetch: fetcher, signal: () => timed(ms, outer), now };
  const replies = await Promise.all(tested.map((model) => replyStep({ protocol: input.protocol,
    baseUrl: input.baseUrl, apiKey: input.apiKey, model }, context)));
  return { ok: replies.every((reply) => reply.ok), steps: [listed.step, ...replies], models: listed.models };
}
