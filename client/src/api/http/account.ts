// /v2/account… 和 /v2/session/password、/v2/session/local 的真实现（11-08 首次使用流程）。会话照旧在 HttpOnly cookie 里；
// 本机令牌只在调用方给了时放进请求头，不写日志、不进错误文案。

import { Type } from 'typebox';
import type { AccountApi } from '../account-client.ts';
import {
  ACCOUNT_HANDLES_PATH,
  ACCOUNT_PASSWORD_PATH,
  ACCOUNT_PATH,
  ACCOUNT_SETUP_PATH,
  ACCOUNT_STATE_PATH,
  AccountPasswordResponseSchema,
  AccountSetupResponseSchema,
  AccountStateSchema,
  HandleAvailabilitySchema,
  LOCAL_SESSION_PATH,
  LOCAL_TOKEN_HEADER,
  PASSWORD_SESSION_PATH,
  SessionViewSchema,
  type AccountPasswordRequest,
  type AccountPasswordResponse,
  type AccountSetupRequest,
  type AccountSetupResponse,
  type AccountState,
  type HandleAvailability,
  type PasswordSessionRequest,
  type SessionView,
} from '../shared.ts';
import type { Transport } from './transport.ts';

/** 改名字的回答只看成没成；改完再读一次 state（接口约定没定回答的形状）。 */
const AnyBodySchema = Type.Unknown();

function tokenHeader(localToken: string | null): Record<string, string> {
  return localToken === null ? {} : { [LOCAL_TOKEN_HEADER]: localToken };
}

export class HttpAccount implements AccountApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  state(signal?: AbortSignal): Promise<AccountState> {
    return this.transport.request({ method: 'GET', path: ACCOUNT_STATE_PATH, schema: AccountStateSchema,
      what: '读账号状态', lostAs: 'failed', signal });
  }

  handle(handle: string, signal?: AbortSignal): Promise<HandleAvailability> {
    return this.transport.request({ method: 'GET', path: `${ACCOUNT_HANDLES_PATH}/${encodeURIComponent(handle)}`,
      schema: HandleAvailabilitySchema, what: '查 @账号', lostAs: 'failed', signal });
  }

  setup(input: AccountSetupRequest, localToken: string | null): Promise<AccountSetupResponse> {
    return this.transport.request({ method: 'POST', path: ACCOUNT_SETUP_PATH, body: input,
      headers: tokenHeader(localToken), schema: AccountSetupResponseSchema, what: '建账号', lostAs: 'uncertain' });
  }

  signIn(input: PasswordSessionRequest): Promise<SessionView> {
    return this.transport.request({ method: 'POST', path: PASSWORD_SESSION_PATH, body: input,
      schema: SessionViewSchema, what: '登录', lostAs: 'failed' });
  }

  signInLocal(deviceName: string, localToken: string): Promise<SessionView> {
    return this.transport.request({ method: 'POST', path: LOCAL_SESSION_PATH, body: { deviceName },
      headers: tokenHeader(localToken), schema: SessionViewSchema, what: '登录这台电脑', lostAs: 'failed' });
  }

  setPassword(input: AccountPasswordRequest, localToken: string | null): Promise<AccountPasswordResponse> {
    return this.transport.request({ method: 'PUT', path: ACCOUNT_PASSWORD_PATH, body: input,
      headers: tokenHeader(localToken), schema: AccountPasswordResponseSchema, what: '设密码', lostAs: 'uncertain' });
  }

  async rename(displayName: string): Promise<AccountState> {
    await this.transport.request({ method: 'PATCH', path: ACCOUNT_PATH, body: { displayName },
      schema: AnyBodySchema, what: '改名字', lostAs: 'uncertain' });
    return this.state();
  }
}
