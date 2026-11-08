// /v2/push 的真实现：VAPID 公钥、订阅、退订。endpoint 和 keys 是这台浏览器的推送能力，只发给服务端，不写日志。

import type { PushApi } from '../client.ts';
import {
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  PushKeyResponseSchema,
  SubscribePushResponseSchema,
  UnsubscribePushResponseSchema,
} from '../shared.ts';
import type {
  PushKeyResponse,
  SubscribePushRequest,
  SubscribePushResponse,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
} from '../types.ts';
import type { Transport } from './transport.ts';
import { PushStatusSchema, type PushStatus } from '../shared.ts';

export class HttpPush implements PushApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  status(signal?: AbortSignal): Promise<PushStatus> {
    return this.transport.request({ method: 'GET', path: PUSH_SUBSCRIPTIONS_PATH,
      schema: PushStatusSchema, what: '读本设备推送状态', lostAs: 'failed', signal });
  }

  async key(signal?: AbortSignal): Promise<PushKeyResponse> {
    return this.transport.request({
      method: 'GET',
      path: PUSH_KEY_PATH,
      schema: PushKeyResponseSchema,
      what: '读推送公钥',
      lostAs: 'failed',
      signal,
    });
  }

  async subscribe(input: SubscribePushRequest): Promise<SubscribePushResponse> {
    return this.transport.request({
      method: 'POST',
      path: PUSH_SUBSCRIPTIONS_PATH,
      body: input,
      schema: SubscribePushResponseSchema,
      what: '登记系统通知',
      lostAs: 'uncertain',
    });
  }

  async unsubscribe(input: UnsubscribePushRequest): Promise<UnsubscribePushResponse> {
    return this.transport.request({
      method: 'DELETE',
      path: PUSH_SUBSCRIPTIONS_PATH,
      body: input,
      schema: UnsubscribePushResponseSchema,
      what: '退订系统通知',
      lostAs: 'uncertain',
    });
  }
}
