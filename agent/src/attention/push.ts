import { ASK_KIND_LABELS } from '../../shared/api/asks.ts';
import type { NotifyKind, NotifyKinds, PushPayload } from '../../shared/api/push.ts';
import type { Ask, PushSubscription } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { cleanOutboundJson } from '../outbound/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { AttentionError } from './errors.ts';
import type { Notifier } from './presenter.ts';
import { decodeSubscriberKeys, encryptPayload, vapidAuthorization, type VapidKeys } from './web-push-crypto.ts';

import { NOTICE_TITLE, PUSH_BODY, TEST_NOTICE_BODY, type PushTestResponse } from '../../shared/api/index.ts';
export { PUSH_BODY } from '../../shared/api/index.ts';
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
export const PUSH_TIMEOUT_MS = 10_000;
const GONE_STATUSES = new Set([404, 410]);

export interface PushRequest {
  headers: Record<string, string>;
  body: Buffer;
}

/** Sends one request to a push service; tests pass a fake, the service uses `fetchTransport`. */
export type PushTransport = (endpoint: string, request: PushRequest) => Promise<{ status: number }>;

export const fetchTransport: PushTransport = async (endpoint, request) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: request.headers,
    body: new Uint8Array(request.body),
    redirect: 'error',
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return { status: response.status };
};

export type PushState = Pick<StateService, 'pushSubscriptions' | 'devices'>;

export interface PushServiceOptions {
  state: PushState;
  keys: VapidKeys;
  /** RFC 8292 `sub`: how the push service can reach the operator. */
  subject: string;
  transport?: PushTransport;
  now?: () => Date;
  kinds?: () => NotifyKinds;
}

export function payloadFor(ask: Ask): PushPayload {
  return {
    title: ASK_KIND_LABELS[ask.kind],
    body: PUSH_BODY,
    url: `/?ask=${encodeURIComponent(ask.id)}`,
    tag: `ask-${ask.id}`,
  };
}

export class PushService implements Notifier {
  readonly #state: PushState;
  readonly #keys: VapidKeys;
  readonly #subject: string;
  readonly #transport: PushTransport;
  readonly #now: () => Date;
  readonly #kinds: (() => NotifyKinds) | undefined;

  constructor(options: PushServiceOptions) {
    this.#state = options.state;
    this.#keys = options.keys;
    this.#subject = options.subject;
    this.#transport = options.transport ?? fetchTransport;
    this.#now = options.now ?? (() => new Date());
    this.#kinds = options.kinds;
  }

  get publicKey(): string {
    return this.#keys.publicKey;
  }

  subscribe(deviceId: string, endpoint: string, keys: { p256dh: string; auth: string }): PushSubscription {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch (error) {
      throw new AttentionError('invalid_subscription', `订阅地址不是合法的网址（${errorCategory(error)}）。`, 'endpoint');
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new AttentionError('invalid_subscription', '订阅地址只收不带用户名密码的 https 地址。', 'endpoint');
    }
    try {
      decodeSubscriberKeys(keys);
    } catch {
      throw new AttentionError('invalid_subscription', '浏览器给的订阅钥匙不对，请重新订阅。', 'keys');
    }
    return this.#state.pushSubscriptions.upsert({ deviceId, endpoint, ...keys });
  }

  /** True when the endpoint was subscribed until now. */
  unsubscribe(endpoint: string): boolean {
    const before = this.#state.pushSubscriptions.byEndpoint(endpoint);
    if (before === undefined || before.revokedAt !== null) {
      return false;
    }
    this.#state.pushSubscriptions.revoke(endpoint, this.#now().toISOString());
    return true;
  }

  /** One notification for the card to every subscription of a device that is still paired. */
  async notify(ask: Ask): Promise<void> {
    await this.announce(payloadFor(ask), 'ask');
  }

  async announce(payload: PushPayload, kind?: NotifyKind): Promise<void> {
    if (kind !== undefined && this.#kinds?.()[kind] === false) return;
    const body = Buffer.from(JSON.stringify(cleanOutboundJson(payload)), 'utf8');
    const targets = this.#state.pushSubscriptions.active().filter((subscription) => {
      const device = this.#state.devices.get(subscription.deviceId);
      return device !== undefined && device.revokedAt === null;
    });
    await Promise.all(targets.map((subscription) => this.#send(subscription, body)));
  }

  async test(deviceId: string): Promise<PushTestResponse> {
    const targets = this.#state.pushSubscriptions.active().filter((row) => row.deviceId === deviceId);
    if (targets.length === 0) return { sent: 0, error: '这台设备还没打开系统通知' };
    const payload = { title: NOTICE_TITLE, body: TEST_NOTICE_BODY, url: '/', tag: 'push-test' };
    const body = Buffer.from(JSON.stringify(cleanOutboundJson(payload)), 'utf8');
    const results = await Promise.all(targets.map((subscription) => this.#send(subscription, body)));
    const failed = targets.find((_subscription, index) => results[index] !== 'delivered');
    return { sent: results.filter((result) => result === 'delivered').length,
      error: failed === undefined ? null
        : this.#state.pushSubscriptions.byEndpoint(failed.endpoint)?.lastError ?? '推送服务没收下' };
  }

  /** Only about the subscription the request went to: a re-subscribed endpoint keeps its new state. */
  #record(subscription: PushSubscription, patch: Parameters<PushState['pushSubscriptions']['record']>[2]): void {
    this.#state.pushSubscriptions.record(subscription.id, subscription.generation, patch);
  }

  async #deliver(endpoint: string, request: PushRequest): Promise<{ status: number }> {
    try {
      return await this.#transport(endpoint, request);
    } catch (error) {
      safeLog('warn', 'push_retried', { category: errorCategory(error) });
      return this.#transport(endpoint, request);
    }
  }

  async #send(subscription: PushSubscription, payload: Buffer): Promise<'delivered' | 'gone' | 'failed'> {
    const now = this.#now();
    let status: number;
    try {
      const request: PushRequest = {
        headers: {
          authorization: vapidAuthorization(subscription.endpoint, this.#keys, this.#subject, now),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(PUSH_TTL_SECONDS),
          urgency: 'high',
        },
        body: encryptPayload(payload, subscription),
      };
      ({ status } = await this.#deliver(subscription.endpoint, request));
    } catch (error) {
      const reason = errorCategory(error);
      safeLog('error', 'push_failed', { objectId: subscription.id, category: reason });
      this.#record(subscription, { lastError: `发送失败（${reason}）` });
      return 'failed';
    }
    if (status >= 200 && status < 300) {
      this.#record(subscription, { lastSentAt: now.toISOString(), lastError: null });
      return 'delivered';
    }
    if (GONE_STATUSES.has(status)) {
      this.#record(subscription, {
        revokedAt: now.toISOString(),
        lastError: `推送服务说这个订阅已失效（HTTP ${status}）`,
      });
      return 'gone';
    }
    safeLog('error', 'push_rejected', { objectId: subscription.id, status });
    this.#record(subscription, { lastError: `推送服务拒收（HTTP ${status}）` });
    return 'failed';
  }
}
