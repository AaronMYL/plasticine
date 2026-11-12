// 账号与密码登录（11-08 首次使用流程，agent/shared/api/account.ts）：建账号、@账号能不能用、密码登录、本机登录、
// 设 / 改密码、改名字。http/ 的真实现和 fake/ 的内存实现都满足这里。
// 本机令牌（桌面客户端经 server.localGrant() 取）只放在请求头 x-plasticine-local-token 里，调用方传进来，这里不存。

import type {
  AccountPasswordRequest,
  AccountPasswordResponse,
  AccountSetupRequest,
  AccountSetupResponse,
  AccountState,
  HandleAvailability,
  OwnUrlView,
  WorkLimitSetting,
  WorkLimitView,
  PasswordSessionRequest,
  SessionView,
} from './shared.ts';

export interface AccountApi {
  /** GET /v2/account/state（不用登录）：要不要先建账号、预填的 @账号、有没有设过密码、手机用的网址。 */
  state(signal?: AbortSignal): Promise<AccountState>;
  /** GET /v2/account/handles/:handle（不用登录）：这个 @账号能不能用。 */
  handle(handle: string, signal?: AbortSignal): Promise<HandleAvailability>;
  /** POST /v2/account/setup（不用登录）：凭本机令牌或建账号链接里的 setupToken 之一。 */
  setup(input: AccountSetupRequest, localToken: string | null): Promise<AccountSetupResponse>;
  /** POST /v2/session/password（不用登录）：@账号 + 密码登录这台设备。 */
  signIn(input: PasswordSessionRequest): Promise<SessionView>;
  /** POST /v2/session/local（要本机令牌）：桌面客户端本机直接登录，不问密码。 */
  signInLocal(deviceName: string, localToken: string): Promise<SessionView>;
  /** PUT /v2/account/password（要登录）：第一次设 / 改密码；带本机令牌时不用旧密码。 */
  setPassword(input: AccountPasswordRequest, localToken: string | null): Promise<AccountPasswordResponse>;
  /** PATCH /v2/account（要登录）：改名字。 */
  rename(displayName: string): Promise<AccountState>;
  /** GET /v2/account/own-url（要登录）：「在别的设备上用」里自己的网址。 */
  ownUrl(signal?: AbortSignal): Promise<OwnUrlView>;
  /** PUT /v2/account/own-url（要登录）：存一个 https 网址，null 清掉。 */
  setOwnUrl(ownUrl: string | null): Promise<OwnUrlView>;
  /** GET /v2/account/work-limit（要登录）：同时做几件事（设置 · AI）。 */
  workLimit(signal?: AbortSignal): Promise<WorkLimitView>;
  /** PUT /v2/account/work-limit（要登录）：'auto' 或 1–8，马上生效。 */
  setWorkLimit(setting: WorkLimitSetting): Promise<WorkLimitView>;
}
