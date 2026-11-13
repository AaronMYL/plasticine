import { expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { EventsHub } from '../../src/api/events-hub.ts';
import { ActionOps } from '../../src/state/action-ops.ts';
import { MatesStore } from '../../src/views/mates/mates-store.ts';
import { MateActions } from '../../src/views/mates/mate-actions.ts';
import { createRequestId } from '../../src/api/request-id.ts';

it('创建结果不确定后重载仍用原请求核实，不因换了表单内容建第二位', async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
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
  expect(await first.create({ name: '资料队友', avatar: 'cat', hue: 'sky', role: '整理资料', soul: '', purpose: null }))
    .toBeNull();
  const resumed = new MateActions(fake.api, new ActionOps(storage), directory);
  const result = await resumed.retry('mates:create');
  expect(result).toMatchObject({ name: '资料队友' });
  expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
  expect((await fake.api.mates.list()).mates).toHaveLength(1);
});

it('群任务发布与领取回执丢失，重载后沿原标识核实同一张卡', async () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); } };
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const make = (name: string) => fake.api.mates.create({ requestId: createRequestId(), name, avatar: 'cat',
    hue: 'sky', role: '核对资料', soul: '', purpose: null });
  const [one, two] = await Promise.all([make('研究员'), make('编辑队友')]);
  const group = await fake.api.mateGroups.create({ requestId: createRequestId(), name: '资料小组',
    mateIds: [one.id, two.id] });
  const directory = new MatesStore(fake.api, new EventsHub(fake.api.events));
  const create = fake.api.mateGroups.createTask.bind(fake.api.mateGroups);
  const publish = vi.spyOn(fake.api.mateGroups, 'createTask').mockImplementationOnce(async (id, body) => {
    await create(id, body);
    throw new ApiError({ kind: 'uncertain', code: 'network', message: '回执未到' });
  }).mockImplementation(create);
  const first = new MateActions(fake.api, new ActionOps(storage), directory);
  expect(await first.createTask(group.id, '核对来源\n保留全部出处。')).toBeNull();
  const resumed = new MateActions(fake.api, new ActionOps(storage), directory);
  const result = await resumed.retry(`mate-groups:task:create:${group.id}`);
  expect(publish.mock.calls[1]).toEqual(publish.mock.calls[0]);
  expect(result).toHaveProperty('line');
  const task = (await fake.api.mateGroups.listTasks(group.id)).lines[0]!;
  const handoff = fake.api.mates.handoff.bind(fake.api.mates);
  const claim = vi.spyOn(fake.api.mates, 'handoff').mockImplementationOnce(async (body) => {
    await handoff(body);
    throw new ApiError({ kind: 'uncertain', code: 'network', message: '回执未到' });
  }).mockImplementation(handoff);
  expect(await resumed.claimTask(task, one.id, '核对来源\n保留全部出处。')).toBeNull();
  const next = new MateActions(fake.api, new ActionOps(storage), directory);
  expect(await next.retry(`mate-groups:task:claim:${task.id}`))
    .toMatchObject({ line: { id: task.id, mateId: one.id } });
  expect(claim.mock.calls[1]).toEqual(claim.mock.calls[0]);
  expect((await fake.api.mateGroups.listTasks(group.id)).lines).toHaveLength(1);
  directory.stop();
});
