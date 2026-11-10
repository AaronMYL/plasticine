import { waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { EventsHub } from '../../src/api/events-hub.ts';
import { createRequestId } from '../../src/api/request-id.ts';
import { MatesStore } from '../../src/views/mates/mates-store.ts';

it('队友资料随line_changed更新，停止后晚到的请求不覆盖已卸载会话', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const mate = await fake.api.mates.create({ requestId: createRequestId(), name: '资料队友', avatar: '研', hue: 'sky',
    role: '核对资料', soul: '', purpose: null });
  const hub = new EventsHub(fake.api.events);
  const store = new MatesStore(fake.api, hub);
  store.start(); hub.start();
  try {
    await waitFor(() => expect(store.data.get().mates[0]?.name).toBe('资料队友'));
    await fake.api.mates.update(mate.id, { requestId: createRequestId(), version: mate.version, name: '研究队友' });
    await waitFor(() => expect(store.data.get().mates[0]?.name).toBe('研究队友'));
    let finish!: (value: Awaited<ReturnType<typeof fake.api.mates.list>>) => void;
    fake.api.mates.list = () => new Promise((resolve) => { finish = resolve; });
    const pending = store.reload();
    store.stop();
    finish({ mates: [], groups: [], legacyChats: [] });
    await pending;
    expect(store.data.get().mates[0]?.name).toBe('研究队友');
  } finally { store.stop(); hub.stop(); }
});
