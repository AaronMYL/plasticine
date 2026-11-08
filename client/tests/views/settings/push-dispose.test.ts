// 通知开关的实时层卸掉（401、重新配对）之后：进行中的打开作废，公钥回来了也不再订阅、不再登记（review-followups 912f540）。

import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import type { PushKeyResponse } from '../../../src/api/types.ts';
import { PushSwitch } from '../../../src/views/settings/push-switch.ts';
import { NOW } from '../../helpers.tsx';

describe('通知开关 · 卸掉之后', () => {
  it('等公钥时实时层卸掉：公钥回来后不订阅、不登记，状态也不写回', async () => {
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
