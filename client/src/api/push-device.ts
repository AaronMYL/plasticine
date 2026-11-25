import { createContext, useContext } from 'react';
import { Value } from 'typebox/value';
import { PushEndpointSchema, PushKeysSchema } from './shared.ts';

export type PushPermission = 'default' | 'granted' | 'denied';

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  unsubscribe(): Promise<boolean>;
}

export interface PushDevice {
  unsupportedReason(): string | null;
  permission(): PushPermission;
  requestPermission(): Promise<PushPermission>;
  current(): Promise<DeviceSubscription | null>;
  subscribe(publicKey: string): Promise<DeviceSubscription>;
  close?(tags: readonly string[]): Promise<void>;
}

export const SERVICE_WORKER_URL = '/sw.js';

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

export function toDeviceSubscription(subscription: PushSubscription): DeviceSubscription {
  const json = subscription.toJSON();
  const keys = { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' };
  if (!Value.Check(PushEndpointSchema, subscription.endpoint) || !Value.Check(PushKeysSchema, keys)) {
    throw new Error('浏览器给的推送订阅格式不对（endpoint 不是 https，或者钥匙长度不对）');
  }
  return { endpoint: subscription.endpoint, keys, unsubscribe: () => subscription.unsubscribe() };
}

export interface PushEnvironment {
  notification: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  secure: boolean;
  ios: boolean;
  standalone: boolean;
}

export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

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
    async close(tags: readonly string[]) {
      const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
      if (existing === undefined) return;
      for (const tag of tags) {
        for (const shown of await existing.getNotifications({ tag })) shown.close();
      }
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
