// /v2/session 的真实现：读当前会话、退出（cookie plasticine_session，HttpOnly，前端碰不到）。11-08 去掉配对码，
// 登录在 account.ts（@账号 + 密码、本机令牌）。

import type { SessionApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import { LogoutResponseSchema, SESSION_PATH, SessionViewSchema } from '../shared.ts';
import type { SessionView } from '../types.ts';
import type { Transport } from './transport.ts';

export class HttpSession implements SessionApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async current(signal?: AbortSignal): Promise<SessionView | null> {
    try {
      return await this.transport.request({
        method: 'GET',
        path: SESSION_PATH,
        schema: SessionViewSchema,
        what: '读登录状态',
        lostAs: 'failed',
        signal,
      });
    } catch (cause) {
      // 没会话就是还没配对：配对页，不是错误。
      if (cause instanceof ApiError && cause.kind === 'unauthorized') {
        return null;
      }
      throw cause;
    }
  }

  async logout(): Promise<void> {
    await this.transport.request({
      method: 'DELETE',
      path: SESSION_PATH,
      schema: LogoutResponseSchema,
      what: '退出登录',
      lostAs: 'failed',
    });
  }
}
