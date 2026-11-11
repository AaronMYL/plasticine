import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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

it('群任务列表随事件更新，停启后重新读取并保持真实任务身份', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const make = (name: string) => fake.api.mates.create({ requestId: createRequestId(), name,
    avatar: '研', hue: 'sky', role: '核对资料', soul: '', purpose: null });
  const mates = await Promise.all([make('研究员'), make('编辑队友')]);
  const group = await fake.api.mateGroups.create({ requestId: createRequestId(), name: '资料小组',
    mateIds: mates.map((mate) => mate.id) });
  const hub = new EventsHub(fake.api.events);
  const store = new MatesStore(fake.api, hub);
  const list = store.taskList(group.id);
  store.start(); hub.start();
  try {
    await waitFor(() => expect(list.get().status).toBe('ready'));
    const { line } = await fake.api.mateGroups.createTask(group.id,
      { requestId: createRequestId(), text: '核对来源' });
    await waitFor(() => expect(list.get().lines.map((item) => item.id)).toEqual([line.id]));
    fake.control.lines.put(fake.control.lines.blank('ordinary', 'background', '普通后台',
      { parentLineId: group.lineId, mateGroupId: group.id, status: 'paused' }));
    store.stop();
    const read = vi.spyOn(fake.api.mateGroups, 'listTasks');
    store.start();
    await waitFor(() => expect(read).toHaveBeenCalledWith(group.id));
    expect(list.get().lines.map((item) => item.id)).toEqual([line.id]);
  } finally { store.stop(); hub.stop(); }
});
