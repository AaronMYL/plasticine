import type { PushApi } from '../client.ts';
import type {
  PushKeyResponse,
  SubscribePushRequest,
  SubscribePushResponse,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
} from '../types.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';
import { NOTIFY_KINDS_DEFAULT, type NotifyKinds, type PushStatus, type PushTestResponse } from '../shared.ts';

export const FAKE_VAPID_PUBLIC_KEY = `BA${'A'.repeat(85)}`;

export interface FakePushDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
}

export class FakePush implements PushApi {
  private readonly owners = new Map<string, string>();
  private readonly endpoints = new Map<string, SubscribePushResponse['subscription']>();
  private readonly deps: FakePushDeps;
  private sequence = 0;

  constructor(deps: FakePushDeps) {
    this.deps = deps;
  }

  async key(): Promise<PushKeyResponse> {
    this.deps.session.require();
    return { publicKey: FAKE_VAPID_PUBLIC_KEY };
  }

  async status(): Promise<PushStatus> {
    this.deps.session.require();
    const deviceId = this.deps.session.currentSession()?.device.id;
    return { subscribed: [...this.endpoints.keys()].some((endpoint) => this.owners.get(endpoint) === deviceId) };
  }

  async subscribe(input: SubscribePushRequest): Promise<SubscribePushResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('push', input.requestId, 'POST /v2/push/subscriptions', () => {
      this.owners.set(input.endpoint, this.deps.session.currentSession()?.device.id ?? '');
      const existing = this.endpoints.get(input.endpoint);
      if (existing !== undefined) {
        return { subscription: existing };
      }
      this.sequence += 1;
      const subscription = {
        id: `push_${this.sequence}`,
        endpointHost: new URL(input.endpoint).host,
        createdAt: this.deps.now().toISOString(),
        lastSentAt: null,
      };
      this.endpoints.set(input.endpoint, subscription);
      return { subscription };
    });
  }

  async unsubscribe(input: UnsubscribePushRequest): Promise<UnsubscribePushResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('push', input.requestId, 'DELETE /v2/push/subscriptions', () => ({
      removed: this.endpoints.delete(input.endpoint),
    }));
  }

  async test(): Promise<PushTestResponse> {
    this.deps.session.require();
    const deviceId = this.deps.session.currentSession()?.device.id;
    const mine = [...this.endpoints.keys()].filter((endpoint) => this.owners.get(endpoint) === deviceId).length;
    return mine === 0 ? { sent: 0, error: '这台设备还没打开系统通知' } : { sent: mine, error: null };
  }

  watching: string | null = null;

  async presence(conversation: string | null): Promise<void> {
    this.deps.session.require();
    this.watching = conversation;
  }

  storedKinds: NotifyKinds = { ...NOTIFY_KINDS_DEFAULT };

  async kinds(): Promise<NotifyKinds> {
    this.deps.session.require();
    return { ...this.storedKinds };
  }

  async saveKinds(kinds: NotifyKinds): Promise<NotifyKinds> {
    this.deps.session.require();
    this.storedKinds = { ...kinds };
    return { ...this.storedKinds };
  }

  subscribed(): string[] {
    return [...this.endpoints.keys()];
  }
}
