import type { DeviceSubscription, PushDevice, PushPermission } from '../push-device.ts';

export interface FakePushDeviceOptions {
  unsupported?: string | null;
  permission?: PushPermission;
  answer?: Exclude<PushPermission, 'default'>;
}

const FAKE_ENDPOINT = 'https://push.example.test/send/fake-device';
const FAKE_KEYS = { p256dh: `BB${'C'.repeat(85)}`, auth: 'D'.repeat(22) };

export class FakePushDevice implements PushDevice {
  unsupported: string | null;
  state: PushPermission;
  answer: Exclude<PushPermission, 'default'>;
  prompts = 0;
  subscription: DeviceSubscription | null = null;
  subscribedWith: string | null = null;

  constructor(options: FakePushDeviceOptions = {}) {
    this.unsupported = options.unsupported ?? null;
    this.state = options.permission ?? 'default';
    this.answer = options.answer ?? 'granted';
  }

  unsupportedReason(): string | null {
    return this.unsupported;
  }

  permission(): PushPermission {
    return this.state;
  }

  async requestPermission(): Promise<PushPermission> {
    this.prompts += 1;
    if (this.state === 'default') {
      this.state = this.answer;
    }
    return this.state;
  }

  async current(): Promise<DeviceSubscription | null> {
    return this.subscription;
  }

  async subscribe(publicKey: string): Promise<DeviceSubscription> {
    if (this.state !== 'granted') {
      throw new Error('没有通知权限，浏览器不让订阅');
    }
    this.subscribedWith = publicKey;
    const subscription: DeviceSubscription = {
      endpoint: FAKE_ENDPOINT,
      keys: FAKE_KEYS,
      unsubscribe: async () => {
        this.subscription = null;
        return true;
      },
    };
    this.subscription = subscription;
    return subscription;
  }
}
