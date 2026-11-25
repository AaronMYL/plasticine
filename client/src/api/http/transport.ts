import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  ApiError, badResponseError, networkError, NOT_RECEIVED_CODE, unauthorizedError, uncertainError, type ApiErrorKind,
} from '../errors.ts';
import { ApiErrorSchema } from '../shared.ts';
import { readEventStream } from './event-stream.ts';
import { xhrUpload, type UploadLike } from './xhr-upload.ts';

export const REQUEST_TIMEOUT_MS = 15_000;

export interface ResponseLike {
  readonly status: number;
  text(): Promise<string>;
  readonly body?: ReadableStream<Uint8Array> | null;
  blob?(): Promise<Blob>;
  readonly headers?: { get(name: string): string | null };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<ResponseLike>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type LostAs = 'uncertain' | 'failed';

export type QueryValue = string | number | boolean | undefined;

export interface RequestSpec<T extends TSchema> {
  method: HttpMethod;
  path: string;
  query?: Readonly<Record<string, QueryValue>>;
  body?: unknown;
  rawBody?: string;
  binaryBody?: Blob;
  headers?: Readonly<Record<string, string>>;
  schema: T;
  what: string;
  lostAs: LostAs;
  lostError?: (reason: string) => ApiError;
  refine?: (status: number, body: unknown) => ApiError | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  onUploadProgress?: (fraction: number) => void;
}

export interface TransportOptions {
  fetch: FetchLike;
  onUnauthorized: () => void;
  timeoutMs?: number;
  upload?: UploadLike;
}

type RequestOptions = Omit<RequestSpec<TSchema>, 'schema'>;
export type DownloadSpec = RequestOptions;

export interface DownloadedFile {
  blob: Blob;
  name: string;
}

export function dispositionFileName(header: string | null): string | null {
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  return /filename\s*=\s*"([^"]+)"/i.exec(header ?? '')?.[1] ?? null;
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

function kindOf(status: number, code: string, lostAs: LostAs): ApiErrorKind {
  if (status >= 500) {
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
  private readonly upload: UploadLike;

  constructor(options: TransportOptions) {
    this.fetch = options.fetch;
    this.onUnauthorized = options.onUnauthorized;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.upload = options.upload ?? xhrUpload;
  }

  async request<T extends TSchema>(spec: RequestSpec<T>): Promise<Static<T>> {
    const { status, text } = await this.exchange(spec, 'application/json', async (response) => ({
      status: response.status, text: await response.text() }));
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

  async blob(path: string, signal?: AbortSignal): Promise<Blob> {
    const spec: RequestOptions = { method: 'GET', path, what: '读附件原件', lostAs: 'failed', signal };
    const result = await this.exchange(spec, 'application/octet-stream', async (response) => {
      if (response.status >= 200 && response.status < 300 && response.blob !== undefined) {
        return { blob: await response.blob() };
      }
      return { status: response.status, text: await response.text() };
    });
    if (result.blob !== undefined) return result.blob;
    throw this.failure(result.status, parseBody(result.text), spec);
  }

  async download(spec: DownloadSpec, fallbackName: string): Promise<DownloadedFile> {
    const result = await this.exchange(spec, 'application/octet-stream', async (response) => {
      if (response.status >= 200 && response.status < 300 && response.blob !== undefined) {
        const name = dispositionFileName(response.headers?.get('content-disposition') ?? null);
        return { file: { blob: await response.blob(), name: name ?? fallbackName } };
      }
      return { status: response.status, text: await response.text() };
    });
    if (result.file !== undefined) return result.file;
    throw this.failure(result.status, parseBody(result.text), spec);
  }

  async stream<T extends TSchema>(spec: RequestSpec<T>, onEvent: (event: Static<T>) => void): Promise<void> {
    const malformed: { reason: string | null } = { reason: null };
    const failed = await this.exchange(spec, 'text/event-stream', async (response) => {
      if (response.status < 200 || response.status >= 300) {
        return { status: response.status, text: await response.text() };
      }
      await readEventStream(response, (data) => {
        const parsed = parseBody(data);
        if (!parsed.ok || !Value.Check(spec.schema, parsed.value)) {
          malformed.reason = parsed.ok ? firstSchemaError(spec.schema, parsed.value) : parsed.reason;
          throw badResponseError(spec.what, malformed.reason, spec.lostAs === 'uncertain');
        }
        onEvent(parsed.value);
      }).catch((cause: unknown) => {
        if (malformed.reason === null) {
          throw cause;
        }
      });
      return null;
    });
    if (malformed.reason !== null) {
      throw badResponseError(spec.what, malformed.reason, spec.lostAs === 'uncertain');
    }
    if (failed !== null) {
      throw this.failure(failed.status, parseBody(failed.text), spec);
    }
  }

  private async exchange<R>(spec: RequestOptions, accept: string,
    read: (response: ResponseLike) => Promise<R>): Promise<R> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = spec.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`等了 ${timeoutMs} 毫秒没有回答`));
    }, timeoutMs);
    const forward = (): void => controller.abort(spec.signal?.reason);
    spec.signal?.addEventListener('abort', forward, { once: true });
    const headers: Record<string, string> = { ...spec.headers, accept };
    const init: RequestInit = {
      method: spec.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    };
    const bodyText = spec.rawBody ?? (spec.body === undefined ? undefined : JSON.stringify(spec.body));
    if (spec.binaryBody !== undefined) {
      headers['content-type'] = 'application/octet-stream';
      init.body = spec.binaryBody;
    } else if (bodyText !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = bodyText;
    }
    try {
      if (spec.signal?.aborted) controller.abort(spec.signal.reason);
      const response = spec.onUploadProgress === undefined ? await this.fetch(urlOf(spec.path, spec.query), init)
        : await this.upload(urlOf(spec.path, spec.query), init, spec.onUploadProgress);
      return await read(response);
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

  private lost(spec: RequestOptions, reason: string): ApiError {
    if (spec.lostError !== undefined) {
      return spec.lostError(reason);
    }
    return spec.lostAs === 'uncertain' ? uncertainError(spec.what, reason) : networkError(spec.what, reason);
  }

  private failure(status: number, body: ParsedBody, spec: RequestOptions): ApiError {
    const value = body.ok ? body.value : undefined;
    const refined = spec.refine?.(status, value);
    if (refined !== undefined) {
      return refined;
    }
    if (!Value.Check(ApiErrorSchema, value)) {
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
