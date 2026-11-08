// /v2/session 的真实现：配对码换会话（cookie plasticine_session，HttpOnly，前端碰不到），读当前会话，退出。

import type { SessionApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import { LogoutResponseSchema, SESSION_PATH, SessionViewSchema } from '../shared.ts';
import type { PairDeviceRequest, SessionView } from '../types.ts';
import type { Transport } from './transport.ts';

/**
 * 没拿到配对的回答：服务端可能已经用掉了码、登记了设备。配对带着 requestId，同一次配对再发一次，
 * 服务端认出来就给那台设备一个新会话，不会登记第二台。
 */
function pairLost(reason: string): ApiError {
  return new ApiError({
    kind: 'uncertain',
    code: 'receipt_unknown',
    message: `配对：${reason}，尚未取得服务回执，不知道配对成没成。`,
    next: '结果待核实：再点一次「配对」，用的是同一个标识，已经配上就直接登录，不会多登记一台设备。',
  });
}

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

  async pair(input: PairDeviceRequest): Promise<SessionView> {
    return this.transport.request({
      method: 'POST',
      path: SESSION_PATH,
      body: input,
      schema: SessionViewSchema,
      what: '配对',
      lostAs: 'uncertain',
      lostError: pairLost,
    });
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
