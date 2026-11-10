import { expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { EventsHub } from '../../src/api/events-hub.ts';
import { ActionOps } from '../../src/state/action-ops.ts';
import { MatesStore } from '../../src/views/mates/mates-store.ts';
import { MateActions } from '../../src/views/mates/mate-actions.ts';

it('创建结果不确定后重载仍用原请求核实，不因换了表单内容建第二位', async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const hub = new EventsHub(fake.api.events);
  const directory = new MatesStore(fake.api, hub);
  const create = fake.api.mates.create.bind(fake.api.mates);
  const send = vi.spyOn(fake.api.mates, 'create').mockImplementationOnce(async (input) => {
    await create(input);
    throw new ApiError({ kind: 'uncertain', code: 'network', message: '回执未到' });
  }).mockImplementation(create);
  const first = new MateActions(fake.api, new ActionOps(storage), directory);
  expect(await first.create({ name: '资料队友', avatar: '研', hue: 'sky', role: '整理资料', soul: '', purpose: null }))
    .toBeNull();
  const resumed = new MateActions(fake.api, new ActionOps(storage), directory);
  const result = await resumed.retry('mates:create');
  expect(result).toMatchObject({ name: '资料队友' });
  expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
  expect((await fake.api.mates.list()).mates).toHaveLength(1);
});
