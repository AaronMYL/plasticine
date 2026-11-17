// Login and request records of the API: devices, long-lived sessions (decision 90 ②) and the idempotency log
// (《实施方案》第 5 节约定 1). Only SHA-256 hashes of session tokens are stored; the plain value exists only in the
// device's cookie. (Browser pairing codes were retired 11-08; the node pairing codes are in state-devices.ts.)
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

/** SHA-256 in lower-case hex. */
export const HashSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });

// Long enough for "Alex 的 MacBook Pro（家里）", short enough for one line in the device list.
export const DEVICE_NAME_MAX_CHARS = 60;
export const DeviceNameSchema = Type.String({ minLength: 1, maxLength: DEVICE_NAME_MAX_CHARS });

export const DeviceInputSchema = Type.Object(
  {
    name: DeviceNameSchema,
    firstSeenAt: IsoTimeSchema,
    lastSeenAt: IsoTimeSchema,
    /** 桌面客户端凭本机令牌替本机界面登录的那台（迁移 0112）；旧行和别的设备是 false。 */
    local: Type.Optional(Type.Boolean()),
  },
  STRICT,
);
export type DeviceInput = Static<typeof DeviceInputSchema>;
export const DevicePatchSchema = Type.Partial(
  Type.Object({ lastSeenAt: IsoTimeSchema, revokedAt: Nullable(IsoTimeSchema) }),
  STRICT,
);
export const DeviceSchema = Type.Object({
  ...RECORD_META,
  ...DeviceInputSchema.properties,
  revokedAt: Nullable(IsoTimeSchema),
});
export type Device = Static<typeof DeviceSchema>;

export const SessionInputSchema = Type.Object(
  { tokenHash: HashSchema, deviceId: IdSchema, expiresAt: IsoTimeSchema, lastSeenAt: IsoTimeSchema },
  STRICT,
);
export type SessionInput = Static<typeof SessionInputSchema>;
export const SessionPatchSchema = Type.Partial(
  Type.Object({ lastSeenAt: IsoTimeSchema, revokedAt: Nullable(IsoTimeSchema) }),
  STRICT,
);
export const SessionSchema = Type.Object({
  ...RECORD_META,
  ...SessionInputSchema.properties,
  revokedAt: Nullable(IsoTimeSchema),
});
export type Session = Static<typeof SessionSchema>;

/**
 * One answered side-effect request: a resend with the same request_id inside its window gets `status` and `body`
 * back instead of running again. `scope` is the method and route, so an id reused for another route is caught.
 * `bodyDigest` (signed requests, M3): SHA-256 of the request body, so the same id with other content is refused
 * instead of answered with the first result.
 */
export const ApiRequestRecordSchema = Type.Object(
  {
    requestId: IdSchema,
    scope: Type.String({ minLength: 1 }),
    deviceId: Nullable(IdSchema),
    status: Type.Integer({ minimum: 100, maximum: 599 }),
    body: Type.Unknown(),
    createdAt: IsoTimeSchema,
    expiresAt: IsoTimeSchema,
    bodyDigest: Type.Optional(Nullable(Type.String({ minLength: 1 }))),
  },
  STRICT,
);
export type ApiRequestRecord = Static<typeof ApiRequestRecordSchema>;

