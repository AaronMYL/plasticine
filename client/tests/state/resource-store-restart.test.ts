import { describe, expect, it } from 'vitest';
import { EventsHub } from '../../src/state/events-hub.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { ResourceStore } from '../../src/state/resource-store.ts';
import { NOW } from '../helpers.tsx';

async function drain(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('ResourceStore: stopped mid-fetch', () => {
  it('stopping invalidates in-flight fetch; restarting and reopening fetches fresh data', async () => {
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
