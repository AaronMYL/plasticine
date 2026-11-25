// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';

export const API_PREFIX = '/v2';

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
  'signature_required',
  'signature_invalid',
  'signature_expired',
  'quote_immutable',
  'not_ready',
  'already_read',
  'node_credential_invalid',
  'action_conflict',
  'result_unknown',
  'not_configured',
  'credential_unsafe',
  'unsupported_type',
  'too_large',
  'upstream_failed',
] as const;

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

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
export const TimeZoneSchema = Type.String({ minLength: 1, maxLength: 64 });
