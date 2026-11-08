// /v2/session：GET 看谁登录着、DELETE 退出这台浏览器。登录本身在 account.ts（11-08 起 @账号 + 密码、本机令牌；
// 配对码登录下掉了）。会话只在 HttpOnly Cookie 里。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { DeviceViewSchema } from './devices.ts';

export const SESSION_PATH = `${API_PREFIX}/session`;
/** 节点 Bearer 换内部浏览器 Cookie；不使用用户配对码，令牌仅在 Set-Cookie。 */
export const NODE_BROWSER_SESSION_PATH = `${API_PREFIX}/nodes/browser-session`;

// As long as a code lives (decision 90 ②: 10 minutes): a retry after a lost answer comes within seconds or minutes.
export const PAIRING_REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** 登录接口的回执（201，带 Cookie）和 GET /v2/session。 */
export const SessionViewSchema = Type.Object({
  device: DeviceViewSchema,
  session: Type.Object({ createdAt: IsoTimeSchema, expiresAt: IsoTimeSchema }),
  actor: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system')])),
});
export type SessionView = Static<typeof SessionViewSchema>;

/** DELETE /v2/session: this browser's session ends and the cookie is cleared; the device stays registered. */
export const LogoutResponseSchema = Type.Object({ loggedOut: Type.Literal(true) });
export type LogoutResponse = Static<typeof LogoutResponseSchema>;
