// The one error the HTTP layer answers with (《实施方案》第 5 节约定 3): `{ error, code, field?, next? }`, 409 with the
// current version. Errors from state/ are mapped here; anything unexpected becomes a 500 whose sentence promises
// nothing about whether the request took effect (约定 2：回执不确定).

import type { ApiError as ApiErrorBody } from '../../shared/api/index.ts';
import { AttentionError } from '../attention/index.ts';
import { DailyError } from '../daily/index.ts';
import { DeviceError } from '../devices/index.ts';
import { StateError } from '../state/index.ts';
import { SubsError } from '../subs/index.ts';
import { failureText } from '../shared-log.ts';
import { ArtifactError } from '../artifacts/index.ts';
import { CloudToolError } from '../cloud-tools/index.ts';
import { LifeError } from '../life/index.ts';
import { NetworkError } from '../network/index.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly next: string | undefined;
  readonly currentVersion: number | undefined;
  /** Extra keys for the body, e.g. the current note on a 409. */
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: { field?: string; next?: string; currentVersion?: number; extra?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = details.field;
    this.next = details.next;
    this.currentVersion = details.currentVersion;
    this.extra = details.extra ?? {};
  }

  body(): ApiErrorBody & Record<string, unknown> {
    const body: ApiErrorBody & Record<string, unknown> = { ...this.extra, error: this.message, code: this.code };
    if (this.field !== undefined) {
      body.field = this.field;
    }
    if (this.next !== undefined) {
      body.next = this.next;
    }
    if (this.currentVersion !== undefined) {
      body.currentVersion = this.currentVersion;
    }
    return body;
  }
}

export const UNAUTHORIZED_NEXT = '用 @账号和密码登录；忘了密码，在装着 Plasticine 的那台电脑上重设（服务器上运行 plasticine password）。';

export function unauthorized(message = '这台设备还没登录，或者登录已失效。'): ApiError {
  return new ApiError(401, 'unauthorized', message, { next: UNAUTHORIZED_NEXT });
}

export function notFoundError(what: string): ApiError {
  return new ApiError(404, 'not_found', `没有找到${what}。`, { next: '刷新列表后再试。' });
}

export function internalError(): ApiError {
  return new ApiError(500, 'internal_error', '服务出错了，这次操作不确定有没有完成。', {
    next: '稍后刷新看看结果；要重试就用同一个 request_id，不会重复。',
  });
}

// 领域异常可能带输入、SQLite 细节或第三方文本；客户端只按受控 code 取固定提示。
function domainErrorText(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    not_found: '没有找到这条记录。请刷新列表后再试。',
    version_conflict: '记录已经改过。请先读最新版再改。',
    invalid_input: '输入不合要求。请检查对应字段后再试。',
    duplicate: '已经有同一标识的记录。请刷新核对结果。',
    command_not_allowed: '现在不能这样操作。请刷新看可用的操作。',
    illegal_transition: '现在不能这样改变状态。请刷新后再试。',
    conflict: '当前状态不支持这次操作。请刷新核对。',
    invalid_plan: '计划不合要求。请检查步骤及依赖后再试。',
    evidence_missing: '缺少验收证据。请补充证据后再试。',
    ask_closed: '这张卡已经答过或撤回了。请刷新看现在的样子。',
    invalid_answer: '回答不合要求。请检查选项或文字后再试。',
    invalid_ask: '卡片不合要求。请检查内容后再试。',
    invalid_subscription: '推送订阅无效。请重新订阅。',
    not_ready: '回来汇报还没有整理好。请稍后再试。',
    already_read: '这段汇报已经收起了。请刷新查看。',
  };
  return Object.hasOwn(messages, code) ? messages[code] ?? '操作失败，请刷新后再试。' : '操作失败，请刷新后再试。';
}

function fromState(error: StateError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'not_found':
      return new ApiError(404, 'not_found', domainErrorText(error.code), field);
    case 'version_conflict': {
      const version = error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion };
      return new ApiError(409, 'version_conflict', domainErrorText(error.code), { ...version, next: '先读最新版再改。' });
    }
    case 'invalid_input':
      return new ApiError(400, 'invalid_request', domainErrorText(error.code), field);
    case 'duplicate':
      return new ApiError(409, 'duplicate', domainErrorText(error.code), field);
    default:
      return internalError();
  }
}

function fromAttention(error: AttentionError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'not_found':
      return new ApiError(404, 'not_found', domainErrorText(error.code), { next: '刷新后再试。' });
    case 'ask_closed':
      return new ApiError(409, 'ask_closed', domainErrorText(error.code), { next: '这张卡在别处处理过了，刷新看现在的样子。' });
    case 'invalid_answer':
    case 'invalid_ask':
    case 'invalid_subscription':
      return new ApiError(400, 'invalid_request', domainErrorText(error.code), field);
  }
}

function fromDaily(error: DailyError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'no_feed':
      return new ApiError(400, 'no_feed', '这个网站没有订阅源', { field: 'url' });
    case 'not_found':
      return new ApiError(404, 'not_found', domainErrorText(error.code), { ...field, next: '刷新后再试。' });
    case 'invalid_input':
      // 第13批：daily/ 标了写给人看的照原话说哪里不对，不归成一句「输入不合要求」；别的照旧不回显原文。
      return new ApiError(400, 'invalid_request', error.shown ? error.message : domainErrorText(error.code), field);
    case 'conflict':
      return new ApiError(409, 'conflict', domainErrorText(error.code), field);
    case 'rate_limited':
      return new ApiError(429, 'too_many_attempts', error.message, { ...field, next: '过一会儿再试。' });
    case 'unreachable':
      return new ApiError(502, 'unreachable', error.message, { ...field, next: '过一会儿再试。' });
  }
}

/** M5: devices/ refusals. A wrong code is 401 like the login pairing; a node credential problem is its own 401. */
function fromDevice(error: DeviceError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'not_found':
      return new ApiError(404, 'not_found', error.message, { next: '刷新设备列表后再试。' });
    case 'pairing_code_invalid':
    case 'pairing_code_expired':
    case 'pairing_code_used':
      return new ApiError(401, error.code, error.message, { ...field, next: '在 App 上领一个新码。' });
    case 'credential_invalid':
      return new ApiError(401, 'node_credential_invalid', error.message, { next: '重新配对这台节点。' });
    case 'node_revoked':
      return new ApiError(409, 'conflict', error.message, { ...field, next: '这台节点已经撤销，要用就重新配对。' });
    case 'version_conflict': {
      const version = error.currentVersion !== undefined && error.currentVersion >= 1
        ? { currentVersion: error.currentVersion }
        : {};
      return new ApiError(409, 'version_conflict', error.message, { ...version, next: '先读最新的再改。' });
    }
    case 'action_conflict':
      return new ApiError(409, 'action_conflict', error.message, field);
    case 'invalid_input':
      return new ApiError(400, 'invalid_request', error.message, field);
  }
}

/** M5 乙路: life/, artifacts/ and cloud-tools/ refusals, each with its own status. */
function fromM5b(error: LifeError | ArtifactError | CloudToolError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'not_found':
      return new ApiError(404, 'not_found', failureText(error), { ...field, next: '刷新后再试。' });
    case 'invalid_input':
      return new ApiError(400, 'invalid_request', failureText(error), field);
    case 'conflict':
      return new ApiError(409, 'conflict', failureText(error), { ...field, next: '刷新看现在的样子。' });
    case 'too_large':
      return new ApiError(413, 'too_large', failureText(error), field);
    case 'unsupported_type':
      return new ApiError(415, 'unsupported_type', failureText(error), field);
    case 'not_configured':
      return new ApiError(503, 'not_configured', failureText(error), { ...field, next: '等它接上之后再用；这次什么都没做。' });
    case 'credential_unsafe':
      return new ApiError(503, 'credential_unsafe', failureText(error), field);
    case 'failed':
      return new ApiError(502, 'failed', failureText(error), { ...field, next: '外面的服务没做成，可以再试一次。' });
    case 'unknown':
      return new ApiError(409, 'result_unknown', failureText(error), { ...field, next: '先核实做没做成，再决定要不要重做。' });
    case 'user_takeover':
      return new ApiError(409, 'user_takeover', '用户接手了。', { next: '先核对画面，不要重做刚才的操作。' });
  }
}

/** 第 113 条：network/ 的拒绝。中继那边的话原样转（它本来就是一句给人看的话，不带对方账号细节）。 */
function fromNetwork(error: NetworkError): ApiError {
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case 'not_joined':
      return new ApiError(409, 'not_joined', error.message, { next: '在「设置 · 账号与网络」里加入网络。' });
    case 'already_joined':
      return new ApiError(409, 'conflict', error.message, field);
    case 'not_found':
      return new ApiError(404, 'not_found', error.message, { ...field, next: '刷新联系人列表后再试。' });
    case 'invalid_input':
      return new ApiError(400, 'invalid_request', error.message, field);
    case 'conflict':
      return new ApiError(409, 'conflict', error.message, { ...field, next: '刷新看现在的样子。' });
    case 'safety_changed':
      return new ApiError(409, 'safety_changed', error.message, { next: '在资料栏核对安全码。' });
    case 'relay_refused':
      return new ApiError(400, 'relay_refused', error.message, field);
    case 'relay_unreachable':
      return new ApiError(502, 'relay_unreachable', error.message, { next: '稍后再试；这次什么都没做成。' });
  }
}

/** 空间和订阅（第 6、7 条）：正文或设置不合规是 400，现在的状态不允许（没出样刊就开定时）是 409。 */
function fromSubs(error: SubsError): ApiError {
  if (error.code === 'not_found') {
    return new ApiError(404, 'not_found', error.message);
  }
  if (error.code === 'conflict') {
    return new ApiError(409, 'conflict', error.message, { next: '刷新看现在的样子。' });
  }
  return new ApiError(400, 'invalid_request', error.message);
}

const UNKNOWN_TIME_ZONE = /time zone/i;

function unknownTimeZone(): ApiError {
  return new ApiError(400, 'invalid_request', '不认识这个时区。', {
    field: 'tz',
    next: '用 IANA 时区名，例如 Asia/Shanghai。',
  });
}

/** Every thrown value as the error to answer with; the second value says whether it needs to be logged. */
export function toApiError(error: unknown): { error: ApiError; unexpected: boolean } {
  if (error instanceof ApiError) {
    return { error, unexpected: false };
  }
  if (error instanceof StateError) {
    const mapped = fromState(error);
    return { error: mapped, unexpected: mapped.status >= 500 };
  }
  if (error instanceof AttentionError) {
    return { error: fromAttention(error), unexpected: false };
  }
  if (error instanceof DailyError) {
    return { error: fromDaily(error), unexpected: false };
  }
  if (error instanceof DeviceError) {
    return { error: fromDevice(error), unexpected: false };
  }
  if (error instanceof LifeError || error instanceof ArtifactError || error instanceof CloudToolError) {
    return { error: fromM5b(error), unexpected: false };
  }
  if (error instanceof NetworkError) {
    return { error: fromNetwork(error), unexpected: false };
  }
  if (error instanceof SubsError) {
    return { error: fromSubs(error), unexpected: false };
  }
  if (error instanceof RangeError && UNKNOWN_TIME_ZONE.test(error.message)) {
    // Intl's refusal of an unknown IANA name (a `tz` query value): the caller's input, not a fault here.
    return { error: unknownTimeZone(), unexpected: false };
  }
  return { error: internalError(), unexpected: true };
}
