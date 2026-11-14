// /v2/push 的真实现：VAPID 公钥、订阅、退订。endpoint 和 keys 是这台浏览器的推送能力，只发给服务端，不写日志。

import type { PushApi } from '../client.ts';
import {
  NOTIFY_KINDS_PATH,
  NotifyKindsSchema,
  PRESENCE_PATH,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  PUSH_TEST_PATH,
  PushTestResponseSchema,
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
import { PushStatusSchema, type NotifyKinds, type PushStatus, type PushTestResponse } from '../shared.ts';
import { Type } from 'typebox';

const PresenceAckSchema = Type.Object({ ok: Type.Boolean() });

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

  test(): Promise<PushTestResponse> {
    return this.transport.request({ method: 'POST', path: PUSH_TEST_PATH, body: {}, schema: PushTestResponseSchema,
      what: '发测试通知', lostAs: 'failed' });
  }

  async presence(conversation: string | null): Promise<void> {
    await this.transport.request({ method: 'POST', path: PRESENCE_PATH, body: { conversation },
      schema: PresenceAckSchema, what: '报正在看哪段对话', lostAs: 'failed' });
  }

  kinds(signal?: AbortSignal): Promise<NotifyKinds> {
    return this.transport.request({ method: 'GET', path: NOTIFY_KINDS_PATH, schema: NotifyKindsSchema,
      what: '读通知开关', lostAs: 'failed', signal });
  }

  saveKinds(kinds: NotifyKinds): Promise<NotifyKinds> {
    // 整份存、后到的盖掉先到的：重发一次结果一样，没拿到回答也算失败（界面退回原样，让他再点一次）。
    return this.transport.request({ method: 'PUT', path: NOTIFY_KINDS_PATH, body: kinds, schema: NotifyKindsSchema,
      what: '存通知开关', lostAs: 'failed' });
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
