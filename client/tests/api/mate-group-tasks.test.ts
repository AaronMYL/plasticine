import { expect, it, vi } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createRequestId } from '../../src/api/request-id.ts';
import { createMatesHttp } from '../../src/api/http/mates.ts';
import { Transport } from '../../src/api/http/transport.ts';

it('群任务发布和领取幂等，限定组内队友、原目标和同一条工作线', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const make = (name: string) => fake.api.mates.create({ requestId: createRequestId(), name,
    avatar: 'cat', hue: 'sky', role: '整理资料', soul: '', purpose: null });
  const [one, two, outside] = await Promise.all([make('研究员'), make('编辑队友'), make('组外队友')]);
  const group = await fake.api.mateGroups.create({ requestId: createRequestId(), name: '资料小组',
    mateIds: [one.id, two.id] });
  const body = { requestId: createRequestId(), text: '检查来源\n完整保留原始目标。' };
  const task = await fake.api.mateGroups.createTask(group.id, body);
  expect(await fake.api.mateGroups.createTask(group.id, body)).toEqual(task);
  expect(task.line).toMatchObject({ mateId: null, mateGroupId: group.id, status: 'paused', queued: 1 });
  const input = { requestId: createRequestId(), sourceLineId: task.line.id, groupId: group.id,
    mateId: one.id, goal: body.text };
  await expect(fake.api.mates.handoff({ ...input, requestId: createRequestId(), mateId: outside.id }))
    .rejects.toMatchObject({ status: 400 });
  await expect(fake.api.mates.handoff({ ...input, requestId: createRequestId(), goal: '篡改的目标' }))
    .rejects.toMatchObject({ status: 400 });
  const taken = await fake.api.mates.handoff(input);
  expect(taken.line).toMatchObject({ id: task.line.id, mateId: one.id, status: 'queued' });
  expect(await fake.api.mates.handoff(input)).toEqual(taken);
  await expect(fake.api.mates.handoff({ ...input, requestId: createRequestId(), mateId: two.id }))
    .rejects.toMatchObject({ status: 409 });
  expect((await fake.api.mateGroups.listTasks(group.id)).lines).toHaveLength(1);
  const archived = await fake.api.mateGroups.createTask(group.id,
    { requestId: createRequestId(), text: '归档前的目标' });
  fake.control.lines.change(archived.line.id, { archivedAt: new Date().toISOString() });
  await expect(fake.api.mates.handoff({ ...input, requestId: createRequestId(), sourceLineId: archived.line.id,
    goal: '归档前的目标' })).rejects.toMatchObject({ status: 409 });
  const withdrawn = await fake.api.mateGroups.createTask(group.id,
    { requestId: createRequestId(), text: '撤回前的目标' });
  const queue = (await fake.api.lines.read(withdrawn.line.id, {})).queue[0]!;
  await fake.api.lines.withdraw(withdrawn.line.id, queue.id, { requestId: createRequestId() });
  await expect(fake.api.mates.handoff({ ...input, requestId: createRequestId(), sourceLineId: withdrawn.line.id,
    goal: '撤回前的目标' })).rejects.toMatchObject({ status: 409 });
});

it('群任务 HTTP 使用已批准的共享请求和响应格式', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  const line = fake.control.lines.blank('task-1', 'background', '检查资料', { mateGroupId: 'group-1' });
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 200,
    text: async () => JSON.stringify(_init.method === 'GET' ? { lines: [line] } : { line }) }));
  const { mateGroups } = createMatesHttp(new Transport({ fetch, onUnauthorized: vi.fn() }));
  expect(await mateGroups.listTasks('group-1')).toEqual({ lines: [line] });
  const body = { requestId: createRequestId(), text: '检查资料' };
  expect(await mateGroups.createTask('group-1', body)).toEqual({ line });
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ['/v2/mate-groups/group-1/tasks', 'GET'], ['/v2/mate-groups/group-1/tasks', 'POST'],
  ]);
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual(body);
});
