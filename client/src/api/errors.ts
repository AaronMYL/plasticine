// 接口错误分类（《实施方案》第 5 节四条约定）。
// 界面只看 kind：uncertain 是「结果待核实」，不是失败；unauthorized 触发重新登录；conflict 带服务端当前版本。
// 签名被拒（403 signature_* / device_key_missing）不是 unauthorized：会话还好好的，只是这一次没签对。

import type { NoteView } from './types.ts';

/**
 * 服务端自己说了「没收下」：503 + shutting_down（正在重启，见 agent/src/app/asks.ts、conversation.ts），同一标识
 * 重发不会做两次。别的 503（代理、网关回的）不算。
 */
export const NOT_RECEIVED_CODE = 'shutting_down';

export type ApiErrorKind ='uncertain' | 'unauthorized' | 'conflict' | 'invalid' | 'not_found' | 'failed';

export interface ApiErrorDetails {
  kind: ApiErrorKind;
  /** 中文一句，给人看。 */
  message: string;
  /** 服务端的 snake_case 错误码；客户端自己判出来的也用这个格式。 */
  code: string;
  /** 下一步怎么办，可空。 */
  next?: string | undefined;
  /** 哪个字段不对（400 时）。 */
  field?: string | undefined;
  /** HTTP 状态码；没拿到回答（断网、超时）时没有。 */
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

/** 409：这篇笔记在别处保存了新版本。带上服务端当前版本，界面让人选，不自动覆盖。 */
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

/**
 * 409 version_conflict，带服务端现在那一条（记忆条目、判断、约定、关切、信息流条目）：页面拿到的是旧版，这次没有改。
 * 文案用服务端的，界面让人对照 current 再选，不自动覆盖。M4 的回来汇报另有两种带 current 的 409（already_read、
 * not_ready），code 照服务端写。
 */
export class ConflictError<T> extends ApiError {
  readonly current: T;

  constructor(current: T, message: string, next: string | undefined, code = 'version_conflict') {
    super({ kind: 'conflict', code, message, next, status: 409 });
    this.name = 'ConflictError';
    this.current = current;
  }
}

/**
 * 设备签名被拒的四种（都是 403，服务端 device-signature.ts）：这次什么都没写、也没存回答，重新签一次（或重新配对
 * 之后）用同一个 requestId 再发就行。它们不是 401，不能把人送回配对页。
 */
export const SIGNATURE_REFUSAL_CODES: readonly string[] = [
  'signature_required',
  'signature_invalid',
  'signature_expired',
  'device_key_missing',
];

export function isSignatureRefusal(cause: unknown): boolean {
  return cause instanceof ApiError && SIGNATURE_REFUSAL_CODES.includes(cause.code);
}

/** 这台设备签不了名（没有钥匙、钥匙没登记上）：客户端自己判出来的，请求没有发出去。 */
export function noSigningKeyError(message: string, next: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'device_key_missing', message, next });
}

/** 请求发出去了但没拿到回答：可能已经生效，也可能没有。默认原因是连接中断，超时另写。 */
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

/** 只读的请求没拿到回答：什么都没改，再读一次就行。 */
export function networkError(what: string, reason = '连不上服务'): ApiError {
  return new ApiError({ kind: 'failed', code: 'network', message: `${what}：${reason}。`, next: '检查网络后再试。' });
}

/**
 * 服务端的回答不合 shared 里的 schema：当作格式错误，不拿来用。写操作的 2xx 已经生效了，只是读不懂结果，
 * 所以写操作算「结果待核实」，读操作算失败。
 */
export function badResponseError(what: string, detail: string, uncertain: boolean): ApiError {
  return new ApiError({
    kind: uncertain ? 'uncertain' : 'failed',
    code: 'bad_response',
    message: `${what}：服务的回答格式不对（${detail}）。`,
    next: uncertain ? '结果待核实，稍后点「再核实」。' : '稍后再试；一直这样就是两端版本对不上。',
  });
}

/** 把任何异常变成给人看的一句话加下一步；不是 ApiError 的保留原文，不吞掉。 */
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
