// SPDX-License-Identifier: Apache-2.0
// Pieces every API resource uses (《实施方案》第 5 节): the /v2 prefix, the client's request id for side effects
// and the one error shape. The client imports these instead of keeping its own copy (plasticine-code 底线 4).

import { Type, type Static } from 'typebox';

export const API_PREFIX = '/v2';

/**
 * 约定 1：每个有副作用的请求带客户端生成的稳定标识，24 小时内重发返回同一结果、不重跑。A UUID fits; the pattern
 * keeps it printable and short enough for an index key.
 */
export const RequestIdSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{8,100}$' });
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Set on a response that is the stored answer to an earlier request with the same request id. */
export const REPLAYED_HEADER = 'x-plasticine-replayed';

/** Codes the server answers with today; `code` stays open-ended so a new one does not break an older client. */
export const API_ERROR_CODES = [
  'invalid_request',
  'invalid_content_type',
  'payload_too_large',
  'unauthorized',
  'pairing_code_invalid',
  'pairing_code_expired',
  'pairing_code_used',
  'too_many_attempts',
  'not_found',
  'method_not_allowed',
  'version_conflict',
  'duplicate',
  'request_id_reused',
  'command_not_allowed',
  'conflict',
  'ask_closed',
  'shutting_down',
  'internal_error',
  // 旧设备钥匙接口及旧版客户端的兼容错误码；本人业务确认不再依赖设备签名。
  'signature_required',
  'signature_invalid',
  'signature_expired',
  'device_key_missing',
  'device_key_exists',
  'device_key_too_late',
  // M3: 原话永不改写，只能删（《从零方案》第 9 节）.
  'quote_immutable',
  // M4: 回来四句话还在整理 / 已经在别处点过（409，带 current）.
  'not_ready',
  'already_read',
  // M5 甲路：节点凭证不对或已撤销（401，只在 /v2/nodes/hello 这类节点接口上，不让 App 回配对页）、同一个设备动作标识
  // 用在了另一个动作上、自迭代通道还没接执行器。
  'node_credential_invalid',
  'action_conflict',
  // M5 乙路：外部动作说不清做没做（先核实）、工具还没接上、凭据权限不对、上传的类型不收或太大。
  'result_unknown',
  'not_configured',
  'credential_unsafe',
  'unsupported_type',
  'too_large',
  // 邮件图片代理（2026-11-04）：原图取不到（502）。
  'upstream_failed',
] as const;

/**
 * 约定 3：`{ error: 中文一句, code: snake_case, field?: 哪个字段, next?: 下一步 }`. A 409 also carries the current
 * version. A 401 means the device must pair again (the client raises its re-login event).
 */
export const ApiErrorSchema = Type.Object({
  error: Type.String({ minLength: 1 }),
  code: Type.String({ pattern: '^[a-z][a-z0-9_]*$' }),
  field: Type.Optional(Type.String()),
  next: Type.Optional(Type.String()),
  currentVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type ApiError = Static<typeof ApiErrorSchema>;

export const IsoTimeSchema = Type.String({ minLength: 1, format: 'date-time' });
export const IdSchema = Type.String({ minLength: 1 });

/** 用户的时区（界面不传 tz 时用它）；原来在任务接口里，2026-11-05 任务删了挪到这里。 */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
// IANA names are short (`America/Argentina/Buenos_Aires` is the longest common one).
export const TimeZoneSchema = Type.String({ minLength: 1, maxLength: 64 });
