import { describe, expect, it } from 'vitest';
import { isIosDevice, pushUnsupportedReason, type PushEnvironment } from '../../src/api/push-device.ts';

const READY: PushEnvironment = { notification: true, serviceWorker: true, pushManager: true, secure: true,
  ios: false, standalone: false };

describe('web push eligibility', () => {
  it('desktop browsers with required APIs can enable push', () => {
    expect(pushUnsupportedReason(READY)).toBeNull();
  });

  it('iPhone in Safari: prompts to add to Home Screen and reopen from there first', () => {
    expect(pushUnsupportedReason({ ...READY, ios: true, pushManager: false, notification: false }))
      .toContain('添加到主屏幕');
  });

  it('iPhone from Home Screen: enabled on supported iOS; older iOS asks for iOS 16.4', () => {
    expect(pushUnsupportedReason({ ...READY, ios: true, standalone: true })).toBeNull();
    expect(pushUnsupportedReason({ ...READY, ios: true, standalone: true, pushManager: false }))
      .toContain('16.4');
  });

  it('non-HTTPS origin reports HTTPS is required', () => {
    expect(pushUnsupportedReason({ ...READY, secure: false })).toContain('https');
  });

  it('detects iPhone and desktop-mode iPad', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 0)).toBe(false);
  });
});
