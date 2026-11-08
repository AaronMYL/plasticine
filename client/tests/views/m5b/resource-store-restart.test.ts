// ResourceStore 在拉的半路被停（StrictMode 下实时层先停再起、重新配对后实时层重来）：那一次拉取作废了，状态不能卡在
// 「正在读」，再起来、页面再打开时要重新拉一次（2026-11-03 走查：联系人列表在开发环境一直停在「正在读联系人…」）。

import { describe, expect, it } from 'vitest';
import { EventsHub } from '../../../src/api/events-hub.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { ResourceStore } from '../../../src/views/m5b/resource-store.ts';
import { NOW } from '../../helpers.tsx';

async function drain(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('ResourceStore · 拉的半路被停', () => {
  it('停掉作废了那次拉取；再起来、再打开时重新拉，拿到数据', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const hub = new EventsHub(fake.api.events);
    let calls = 0;
    let release: () => void = () => undefined;
    const store = new ResourceStore<{ n: number }>(hub, async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { n: calls };
    }, () => null);
    store.start();
    store.open();
    expect(store.data.get().status).toBe('loading');
    store.stop();
    store.start();
    store.open();
    release();
    await drain();
    expect(store.data.get().status).toBe('ready');
    expect(store.data.get().value).toEqual({ n: 2 });
  });
});
