import type { NoteView } from './types.ts';

export const NOT_RECEIVED_CODE = 'shutting_down';

export type ApiErrorKind ='uncertain' | 'unauthorized' | 'conflict' | 'invalid' | 'not_found' | 'failed';

export interface ApiErrorDetails {
  kind: ApiErrorKind;
  message: string;
  code: string;
  next?: string | undefined;
  field?: string | undefined;
  status?: number | undefined;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly next: string | undefined;
  readonly field: string | undefined;
  readonly status: number | undefined;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = 'ApiError';
    this.kind = details.kind;
    this.code = details.code;
    this.next = details.next;
    this.field = details.field;
    this.status = details.status;
  }
}

export class NoteConflictError extends ApiError {
  readonly current: NoteView;
  readonly currentVersion: number;

  constructor(current: NoteView, currentVersion: number = current.version) {
    super({
      kind: 'conflict',
      code: 'version_conflict',
      message: '这篇笔记在别处保存了新版本。',
      next: '选「用新版本」或「保留我的」。',
      status: 409,
    });
    this.name = 'NoteConflictError';
    this.current = current;
    this.currentVersion = currentVersion;
  }
}

export class ConflictError<T> extends ApiError {
  readonly current: T;

  constructor(current: T, message: string, next: string | undefined, code = 'version_conflict') {
    super({ kind: 'conflict', code, message, next, status: 409 });
    this.name = 'ConflictError';
    this.current = current;
  }
}

export const SIGNATURE_REFUSAL_CODES: readonly string[] = [
  'signature_required',
  'signature_invalid',
  'signature_expired',
];

export function isSignatureRefusal(cause: unknown): boolean {
  return cause instanceof ApiError && SIGNATURE_REFUSAL_CODES.includes(cause.code);
}

export function uncertainError(what: string, reason = '连接中断'): ApiError {
  return new ApiError({
    kind: 'uncertain',
    code: 'receipt_unknown',
    message: `${what}：${reason}，尚未取得服务回执。`,
    next: '结果待核实，稍后点「再核实」。',
  });
}

export function unauthorizedError(message = '这台设备的会话已失效。', next = '重新登录。'): ApiError {
  return new ApiError({ kind: 'unauthorized', code: 'unauthorized', message, next, status: 401 });
}

export function networkError(what: string, reason = '连不上服务'): ApiError {
  return new ApiError({ kind: 'failed', code: 'network', message: `${what}：${reason}。`, next: '检查网络后再试。' });
}

export function badResponseError(what: string, detail: string, uncertain: boolean): ApiError {
  return new ApiError({
    kind: uncertain ? 'uncertain' : 'failed',
    code: 'bad_response',
    message: `${what}：服务的回答格式不对（${detail}）。`,
    next: uncertain ? '结果待核实，稍后点「再核实」。' : '稍后再试；一直这样就是两端版本对不上。',
  });
}

export function errorText(cause: unknown): string {
  if (cause instanceof ApiError) {
    return cause.next === undefined ? cause.message : `${cause.message}${cause.next}`;
  }
  if (cause instanceof Error) {
    return `出错了：${cause.message}`;
  }
  return `出错了：${String(cause)}`;
}

export function isUncertain(cause: unknown): boolean {
  return cause instanceof ApiError && cause.kind === 'uncertain';
}
