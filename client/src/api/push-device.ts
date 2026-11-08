// 这台浏览器上的系统通知（「立刻打断」档，第 91 条 ⑤）：权限、service worker、PushManager 订阅。
// 界面只经这个接口碰浏览器，测试和假实现换成 fake/fake-push-device.ts。权限只在用户点了开关之后才申请。
// 订阅里的 endpoint 和 keys 是外部输入：先过 shared 的 schema 再交给服务端。

import { createContext, useContext } from 'react';
import { Value } from 'typebox/value';
import { PushEndpointSchema, PushKeysSchema } from './shared.ts';

export type PushPermission = 'default' | 'granted' | 'denied';

/** 这台浏览器的一份推送订阅，只带交给服务端要用的几样。 */
export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  unsubscribe(): Promise<boolean>;
}

export interface PushDevice {
  /** 不支持时返回一句为什么（中文），支持返回 null。 */
  unsupportedReason(): string | null;
  permission(): PushPermission;
  /** 弹浏览器的权限框；只在用户点了开关时调。 */
  requestPermission(): Promise<PushPermission>;
  /** 已有的订阅（打开设置时看开关该是开还是关）。 */
  current(): Promise<DeviceSubscription | null>;
  /** 注册 service worker 并用服务端的公钥订阅。 */
  subscribe(publicKey: string): Promise<DeviceSubscription>;
}

/** service worker 的地址：在 client/public/ 下，构建后在站点根上，管整个站点。 */
export const SERVICE_WORKER_URL = '/sw.js';

/** base64url → 字节：PushManager.subscribe 的 applicationServerKey 要字节。 */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 浏览器给的 PushSubscription → 交给服务端的形状；形状不对就不交。 */
export function toDeviceSubscription(subscription: PushSubscription): DeviceSubscription {
  const json = subscription.toJSON();
  const keys = { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' };
  if (!Value.Check(PushEndpointSchema, subscription.endpoint) || !Value.Check(PushKeysSchema, keys)) {
    throw new Error('浏览器给的推送订阅格式不对（endpoint 不是 https，或者钥匙长度不对）');
  }
  return { endpoint: subscription.endpoint, keys, unsubscribe: () => subscription.unsubscribe() };
}

/** 浏览器有没有网页推送要的几样（iPhone：iOS 16.4 起，网页加到主屏幕、从主屏幕打开才有 PushManager）。 */
export interface PushEnvironment {
  notification: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  secure: boolean;
  ios: boolean;
  /** 从主屏幕（或装好的网页应用）打开的独立窗口。 */
  standalone: boolean;
}

/** iPhone、iPad（iPadOS 默认装成 Mac 的 Safari，靠触点数认）。 */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** 不能开的一句原因（中文）；能开是 null。 */
export function pushUnsupportedReason(env: PushEnvironment): string | null {
  if (env.ios && !env.standalone) {
    return '在 iPhone 上先用 Safari 的「分享」→「添加到主屏幕」，从主屏幕的 Plasticine 打开，再回到这里打开。';
  }
  if (!env.notification || !env.serviceWorker || !env.pushManager) {
    return env.ios ? '要 iOS 16.4 或更新的系统才能收网页通知。' : '这个浏览器不支持网页推送。';
  }
  if (!env.secure) {
    return '只有 https 打开的页面才能收系统通知。';
  }
  return null;
}

function browserPushEnvironment(): PushEnvironment {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    notification: 'Notification' in window,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    secure: window.isSecureContext,
    ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
    standalone,
  };
}

/** 真浏览器上的实现。 */
export function createBrowserPushDevice(): PushDevice {
  const registration = async (): Promise<ServiceWorkerRegistration> => {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    return navigator.serviceWorker.ready;
  };
  return {
    unsupportedReason() {
      return pushUnsupportedReason(browserPushEnvironment());
    },
    permission() {
      return Notification.permission;
    },
    async requestPermission() {
      return Notification.requestPermission();
    },
    async current() {
      const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
      const subscription = await existing?.pushManager.getSubscription();
      return subscription === null || subscription === undefined ? null : toDeviceSubscription(subscription);
    },
    async subscribe(publicKey: string) {
      const ready = await registration();
      const subscription = await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      return toDeviceSubscription(subscription);
    },
  };
}

export const PushDeviceContext = createContext<PushDevice | null>(null);

export function usePushDevice(): PushDevice {
  const device = useContext(PushDeviceContext);
  if (device === null) {
    throw new Error('usePushDevice 必须在 PushDeviceContext 里面用');
  }
  return device;
}
