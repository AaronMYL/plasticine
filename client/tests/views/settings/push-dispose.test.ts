import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import type { PushKeyResponse } from '../../../src/api/types.ts';
import { PushSwitch } from '../../../src/views/settings/push-switch.ts';
import { NOW } from '../../helpers.tsx';

describe('Notification toggle - after unmount', () => {
  it('unmounting while awaiting public key skips subscribe, register, and state writes', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    let release = (_value: PushKeyResponse): void => undefined;
    const key = vi.spyOn(fake.api.push, 'key').mockImplementation(
      () => new Promise<PushKeyResponse>((resolve) => {
        release = resolve;
      }),
    );
    const subscribe = vi.spyOn(fake.api.push, 'subscribe');
    const device = new FakePushDevice({ answer: 'granted' });
    const toggle = new PushSwitch(fake.api, device);
    await toggle.start();
    expect(toggle.store.get().status).toBe('off');
    const enabling = toggle.enable();
    await vi.waitFor(() => expect(key).toHaveBeenCalledTimes(1));
    toggle.dispose();
    release({ publicKey: 'BKey' });
    await enabling;
    expect(device.subscription).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
    expect(toggle.store.get().status).toBe('working');
  });
});
