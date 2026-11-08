// 网页推送能不能开（《优化清单》第 12 条：iPhone 用网页版，要收通知得加到主屏幕并开网页推送）：
// iPhone 上没从主屏幕打开时说清楚先加到主屏幕；系统太旧说要 iOS 16.4；其他浏览器照旧。

import { describe, expect, it } from 'vitest';
import { isIosDevice, pushUnsupportedReason, type PushEnvironment } from '../../src/api/push-device.ts';

const READY: PushEnvironment = { notification: true, serviceWorker: true, pushManager: true, secure: true,
  ios: false, standalone: false };

describe('网页推送的条件', () => {
  it('电脑浏览器都有就能开', () => {
    expect(pushUnsupportedReason(READY)).toBeNull();
  });

  it('iPhone 在 Safari 里直接打开：先加到主屏幕，从主屏幕打开再来开', () => {
    expect(pushUnsupportedReason({ ...READY, ios: true, pushManager: false, notification: false }))
      .toContain('添加到主屏幕');
  });

  it('iPhone 从主屏幕打开、系统够新：能开；系统太旧：说要 iOS 16.4', () => {
    expect(pushUnsupportedReason({ ...READY, ios: true, standalone: true })).toBeNull();
    expect(pushUnsupportedReason({ ...READY, ios: true, standalone: true, pushManager: false }))
      .toContain('16.4');
  });

  it('不是 https：说只有 https 才行', () => {
    expect(pushUnsupportedReason({ ...READY, secure: false })).toContain('https');
  });

  it('认得出 iPhone 和装成电脑的 iPad', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 0)).toBe(false);
  });
});
