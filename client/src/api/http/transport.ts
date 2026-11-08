// 一次 HTTP 请求怎么发、回答怎么读（《实施方案》第 5 节四条约定），各资源文件都经这里：
// - 同源 cookie 会话（credentials: same-origin），请求体一律 JSON。
// - 超时、断网：写操作算「回执不确定」（kind = uncertain），由调用方用同一个 requestId 去查或重发；读操作算失败。
//   这里不自动重发：没带标识的请求重发可能做两次，带标识的由界面决定什么时候核实。
// - 回答先过 shared 里的 schema（typebox Value.Check），不过就当格式错误，不拿来用。
// - 401（code = unauthorized）通知壳回到配对页；其余错误按状态码和 code 分类，文案用服务端给的中文。旧接口的 403 签名类错误
//   （signature_* / device_key_missing）照通用分类走，不通知壳。
// - 需要按原文幂等的请求给 rawBody，去重始终使用这串字节，不再序列化一遍。旧钥匙接口沿用此协议。

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  ApiError,
  badResponseError,
  networkError,
  NOT_RECEIVED_CODE,
  uncertainError,
  unauthorizedError,
} from '../errors.ts';
import type { ApiErrorKind } from '../errors.ts';
import { ApiErrorSchema } from '../shared.ts';

/**
 * 一次请求最多等这么久，超过就当没拿到回答。15 秒：一条消息的 202 和一篇笔记的保存都是本机 SQLite 写一次，
 * 正常在 1 秒内；留足手机弱网的余量，又不让「保存中」挂太久（默认值，接上后按实测再调）。
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/** fetch 回答里用到的部分；测试给假的 fetch 时只要实现这两样。 */
export interface ResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 没拿到回答时这次请求算什么：写操作是「结果待核实」，读操作是失败（什么都没改，再读一次就行）。 */
export type LostAs = 'uncertain' | 'failed';

export type QueryValue = string | number | boolean | undefined;

export interface RequestSpec<T extends TSchema> {
  method: HttpMethod;
  path: string;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
  /**
   * 原样的请求体（已经是 JSON 的字）：确认操作与旧钥匙接口用，去重使用这串字节，不能再序列化一遍。
   * 给了它就不看 body。
   */
  rawBody?: string;
  /** 调用方显式指定的附加请求头。 */
  headers?: Readonly<Record<string, string>>;
  /** 2xx 回答的 schema。 */
  schema: T;
  /** 操作名，写进错误文案：「发送」「保存笔记」。 */
  what: string;
  lostAs: LostAs;
  /** 没拿到回答时换成这个错误（配对这种没法核实的）。 */
  lostError?: (reason: string) => ApiError;
  /** 认得出的错误回答换成专门的错误（笔记 409 带当前版本）；返回 undefined 就走通用分类。 */
  refine?: (status: number, body: unknown) => ApiError | undefined;
  signal?: AbortSignal | undefined;
  /** 这一次请求最多等多久；不给就是 Transport 的默认（上传大文件给得长一些）。 */
  timeoutMs?: number;
}

export interface TransportOptions {
  fetch: FetchLike;
  onUnauthorized: () => void;
  timeoutMs?: number;
}

type ParsedBody = { ok: true; value: unknown } | { ok: false; reason: string };

function parseBody(text: string): ParsedBody {
  if (text === '') {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: `不是 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
}

function firstSchemaError(schema: TSchema, value: unknown): string {
  const first = Value.Errors(schema, value)[0];
  return first === undefined ? '不合 schema' : `${first.instancePath === '' ? '/' : first.instancePath} ${first.message}`;
}

function urlOf(path: string, query: Readonly<Record<string, QueryValue>> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

/** 状态码 + 服务端的 code → 界面看的 kind。 */
function kindOf(status: number, code: string, lostAs: LostAs): ApiErrorKind {
  if (status >= 500) {
    // 500 的文案就是「不确定有没有完成」；503 shutting_down 明说了没收下，可以用同一标识重发；
    // 别的 503（代理、网关回的，或者别的 code）不知道到没到服务，写操作仍待核实（review-followups bd8a36b）。
    const notReceived = status === 503 && code === NOT_RECEIVED_CODE;
    return !notReceived && lostAs === 'uncertain' ? 'uncertain' : 'failed';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (code === 'version_conflict') {
    return 'conflict';
  }
  if (status === 409 || status === 429) {
    return 'failed';
  }
  return status >= 400 ? 'invalid' : 'failed';
}

export class Transport {
  private readonly fetch: FetchLike;
  private readonly onUnauthorized: () => void;
  private readonly timeoutMs: number;

  constructor(options: TransportOptions) {
    this.fetch = options.fetch;
    this.onUnauthorized = options.onUnauthorized;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async request<T extends TSchema>(spec: RequestSpec<T>): Promise<Static<T>> {
    const { status, text } = await this.exchange(spec);
    const body = parseBody(text);
    if (status >= 200 && status < 300) {
      if (!body.ok) {
        throw badResponseError(spec.what, body.reason, spec.lostAs === 'uncertain');
      }
      if (!Value.Check(spec.schema, body.value)) {
        throw badResponseError(spec.what, firstSchemaError(spec.schema, body.value), spec.lostAs === 'uncertain');
      }
      return body.value;
    }
    throw this.failure(status, body, spec);
  }

  /** 发出去并读完回答；计时从发出算到读完。调用方自己取消的照原样抛出，不算没拿到回答。 */
  private async exchange<T extends TSchema>(spec: RequestSpec<T>): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = spec.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`等了 ${timeoutMs} 毫秒没有回答`));
    }, timeoutMs);
    const forward = (): void => controller.abort(spec.signal?.reason);
    spec.signal?.addEventListener('abort', forward, { once: true });
    const headers: Record<string, string> = { ...spec.headers, accept: 'application/json' };
    const init: RequestInit = {
      method: spec.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    };
    const bodyText = spec.rawBody ?? (spec.body === undefined ? undefined : JSON.stringify(spec.body));
    if (bodyText !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = bodyText;
    }
    try {
      const response = await this.fetch(urlOf(spec.path, spec.query), init);
      return { status: response.status, text: await response.text() };
    } catch (cause) {
      if (spec.signal?.aborted === true) {
        throw cause;
      }
      throw this.lost(spec, timedOut ? '连接超时' : '连接中断');
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', forward);
    }
  }

  private lost<T extends TSchema>(spec: RequestSpec<T>, reason: string): ApiError {
    if (spec.lostError !== undefined) {
      return spec.lostError(reason);
    }
    return spec.lostAs === 'uncertain' ? uncertainError(spec.what, reason) : networkError(spec.what, reason);
  }

  private failure<T extends TSchema>(status: number, body: ParsedBody, spec: RequestSpec<T>): ApiError {
    const value = body.ok ? body.value : undefined;
    const refined = spec.refine?.(status, value);
    if (refined !== undefined) {
      return refined;
    }
    if (!Value.Check(ApiErrorSchema, value)) {
      // 不是约定的错误格式：多半是代理或网关回的页面（包括 503），服务本身可能收到也可能没收到。
      if (status >= 500 && spec.lostAs === 'uncertain') {
        return uncertainError(spec.what, `服务回了 ${status}`);
      }
      return new ApiError({
        kind: 'failed',
        code: 'bad_response',
        message: `${spec.what}：服务回了 ${status}，回答不是约定的错误格式。`,
        next: '稍后再试。',
        status,
      });
    }
    if (value.code === 'unauthorized') {
      this.onUnauthorized();
      return unauthorizedError(value.error, value.next ?? '重新登录。');
    }
    return new ApiError({
      kind: kindOf(status, value.code, spec.lostAs),
      code: value.code,
      message: value.error,
      next: value.next,
      field: value.field,
      status,
    });
  }
}
