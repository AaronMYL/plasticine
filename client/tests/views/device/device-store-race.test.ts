import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { EventsHub } from '../../../src/state/events-hub.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import type { NodeListResponse } from '../../../src/api/types.ts';
import { DeviceStore } from '../../../src/views/device/device-store.ts';
import { NOW } from '../../helpers.tsx';

describe('devices tab data store', () => {
  it('stopping initial load and reopening refetches so stale call cannot stick in loading', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    const snapshot = await fake.api.nodes.list();
    const gate = Promise.withResolvers<NodeListResponse>();
    const read = vi.spyOn(fake.api.nodes, 'list').mockImplementationOnce(() => gate.promise);
    const store = new DeviceStore(fake.api, new EventsHub(fake.api.events));
    store.start();
    const first = store.reload();
    store.stop();
    store.start();
    store.open();
    expect(read).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(store.nodes.get().status).toBe('ready'));
    gate.resolve(snapshot);
    await first;
    expect(store.actions.get().status).toBe('ready');
    store.stop();
  });
  it('newer device arriving via event stream mid-fetch survives older snapshot overwrite', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    const old = fake.control.nodes.addNode('家里的 Mac');
    let release = (_value: NodeListResponse): void => undefined;
    vi.spyOn(fake.api.nodes, 'list').mockImplementation(
      () => new Promise<NodeListResponse>((resolve) => {
        release = resolve;
      }),
    );
    const hub = new EventsHub(fake.api.events);
    const store = new DeviceStore(fake.api, hub);
    store.start();
    hub.start();
    const loading = store.reload();
    const renamed = { ...old, name: '书房的 Mac', version: old.version + 1 };
    fake.control.bus.emit({ type: 'node.changed', node: renamed });
    release({ nodes: [old], defaults: old.limits, protectedPaths: [] });
    await loading;
    expect(store.nodes.get().value?.nodes[0]?.name).toBe('书房的 Mac');
    store.stop();
    hub.stop();
  });

  it('load error exposes error state with reason instead of an empty device list', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    fake.control.faults.next('device_read', { kind: 'failed', message: '服务暂时连不上。' });
    const hub = new EventsHub(fake.api.events);
    const store = new DeviceStore(fake.api, hub);
    store.start();
    await store.reload();
    expect(store.nodes.get()).toMatchObject({ status: 'failed', value: null });
    expect(store.nodes.get().error).toContain('服务暂时连不上');
    store.stop();
  });
});
