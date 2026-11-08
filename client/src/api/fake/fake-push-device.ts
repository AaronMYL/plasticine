// 假的浏览器推送：权限框弹几次、用户点了什么、订阅在不在，都由测试或本地开发决定，不碰真浏览器。

import type { DeviceSubscription, PushDevice, PushPermission } from '../push-device.ts';

export interface FakePushDeviceOptions {
  /** 不支持时的原因；null 是支持。 */
  unsupported?: string | null;
  permission?: PushPermission;
  /** 权限框弹出来时用户点什么。 */
  answer?: Exclude<PushPermission, 'default'>;
}

const FAKE_ENDPOINT = 'https://push.example.test/send/fake-device';
// 形状对（p256dh 87 个字符、auth 22 个字符），不是真钥匙。
const FAKE_KEYS = { p256dh: `BB${'C'.repeat(85)}`, auth: 'D'.repeat(22) };

export class FakePushDevice implements PushDevice {
  unsupported: string | null;
  state: PushPermission;
  answer: Exclude<PushPermission, 'default'>;
  /** 权限框弹过几次：只能在点了开关之后。 */
  prompts = 0;
  subscription: DeviceSubscription | null = null;
  /** 订阅时用的公钥。 */
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
