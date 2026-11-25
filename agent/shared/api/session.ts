import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema } from './common.ts';
import { DeviceViewSchema } from './devices.ts';

export const SESSION_PATH = `${API_PREFIX}/session`;
export const NODE_BROWSER_SESSION_PATH = `${API_PREFIX}/nodes/browser-session`;

export const PAIRING_REPLAY_WINDOW_MS = 10 * 60 * 1000;

export const SessionViewSchema = Type.Object({
  device: DeviceViewSchema,
  session: Type.Object({ createdAt: IsoTimeSchema, expiresAt: IsoTimeSchema }),
  actor: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system')])),
});
export type SessionView = Static<typeof SessionViewSchema>;

/** DELETE /v2/session: this browser's session ends and the cookie is cleared; the device stays registered. */
export const LogoutResponseSchema = Type.Object({ loggedOut: Type.Literal(true) });
export type LogoutResponse = Static<typeof LogoutResponseSchema>;
