// /v2/session: one-time pairing code → long-lived session (decision 90 ②). The code is printed by
// agent/src/app/pairing-cli.ts on the server; the session travels only in an HttpOnly cookie.

import { Type, type Static } from 'typebox';
import { DeviceNameSchema } from '../state.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { DeviceViewSchema } from './devices.ts';

export const SESSION_PATH = `${API_PREFIX}/session`;
/** 节点 Bearer 换内部浏览器 Cookie；不使用用户配对码，令牌仅在 Set-Cookie。 */
export const NODE_BROWSER_SESSION_PATH = `${API_PREFIX}/nodes/browser-session`;

// The printed form is 8 characters in two groups (`7KQ4-M2XD`); spaces, hyphens and case do not matter.
export const PAIRING_CODE_INPUT_MAX_CHARS = 32;
// As long as a code lives (decision 90 ②: 10 minutes): a retry after a lost answer comes within seconds or minutes.
export const PAIRING_REPLAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /v2/session. With a request id, a pairing whose answer was lost can be sent again: the same request id with
 * the same code within PAIRING_REPLAY_WINDOW_MS gets a new session for the device that pairing registered (the old
 * token is stored only as a hash, so it cannot be sent back) and no second device. Without one, a used code is used.
 */
export const PairDeviceRequestSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: PAIRING_CODE_INPUT_MAX_CHARS }),
    deviceName: DeviceNameSchema,
    requestId: Type.Optional(RequestIdSchema),
  },
  { additionalProperties: false },
);
export type PairDeviceRequest = Static<typeof PairDeviceRequestSchema>;

/** POST /v2/session (201, sets the cookie) and GET /v2/session. */
export const SessionViewSchema = Type.Object({
  device: DeviceViewSchema,
  session: Type.Object({ createdAt: IsoTimeSchema, expiresAt: IsoTimeSchema }),
  actor: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system')])),
});
export type SessionView = Static<typeof SessionViewSchema>;

/** DELETE /v2/session: this browser's session ends and the cookie is cleared; the device stays registered. */
export const LogoutResponseSchema = Type.Object({ loggedOut: Type.Literal(true) });
export type LogoutResponse = Static<typeof LogoutResponseSchema>;
