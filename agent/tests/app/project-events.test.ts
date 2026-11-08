import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, openEvents, pair, startTestApp, type SseStream, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let app: TestApp | undefined;
let stream: SseStream | undefined;

afterEach(async () => { stream?.close(); await app?.close(); stream = undefined; app = undefined; });

test('另一台设备实时收到项目、待办与资料归属变化；移动资料通知两边，重放和拒绝不通知', async () => {
  app = await startTestApp();
  const writer = await pair(app, '编辑电脑');
  const reader = await pair(app, '阅读手机');
  stream = await openEvents(app, reader);
  await stream.next('ready');
  const event = async (id: string): Promise<void> => {
    assert.deepEqual((await stream!.next('project_invalidated')).event,
      { type: 'project_invalidated', projectId: id });
  };
  const create = async (name: string): Promise<string> => {
    const body = { requestId: newRequestId('project'), name };
    const reply = await call(app!, 'POST', '/v2/projects', { cookie: writer, body });
    assert.equal(reply.status, 201);
    const id = String((json(reply)['project'] as Record<string, unknown>)['id']);
    await event(id);
    assert.equal((await call(app!, 'POST', '/v2/projects', { cookie: writer, body })).status, 201);
    await assert.rejects(stream!.next('project_invalidated', 60), /没等到/);
    return id;
  };
  const first = await create('手机正在看的项目');
  const second = await create('接收资料的项目');
  const edit = await call(app, 'PUT', `/v2/projects/${first}`, { cookie: writer,
    body: { requestId: newRequestId('edit'), version: app.state.projects.require(first).version,
      name: '电脑改过的新名字' } });
  assert.equal(edit.status, 200);
  await event(first);
  const read = json(await call(app, 'GET', `/v2/projects/${first}`, { cookie: reader }));
  assert.equal((read['project'] as Record<string, unknown>)['name'], '电脑改过的新名字');
  const health = await call(app, 'POST', `/v2/projects/${first}/health`, { cookie: writer,
    body: { requestId: newRequestId('health'), version: app.state.projects.require(first).version, value: 'ok' } });
  assert.equal(health.status, 200);
  await event(first);
  const add = await call(app, 'POST', `/v2/projects/${first}/todos`, { cookie: writer,
    body: { requestId: newRequestId('todo'), title: '跨设备核对' } });
  assert.equal(add.status, 201);
  const todoId = String((json(add)['todo'] as Record<string, unknown>)['id']);
  await event(first);
  assert.equal((await call(app, 'PUT', `/v2/projects/${first}/todos/${todoId}`, { cookie: writer,
    body: { requestId: newRequestId('done'), done: true } })).status, 200);
  await event(first);
  const updated = json(await call(app, 'GET', `/v2/projects/${first}`, { cookie: reader }));
  assert.notEqual((updated['todos'] as Record<string, unknown>[])[0]?.['doneAt'], null);
  const targetId = 'https://example.test/material';
  const file = (projectId: string) => call(app!, 'POST', `/v2/projects/${projectId}/items`, { cookie: writer,
    body: { requestId: newRequestId('file'), targetType: 'link', targetId } });
  assert.equal((await file(first)).status, 200);
  await event(first);
  assert.equal((await file(second)).status, 200);
  const moved = [await stream.next('project_invalidated'), await stream.next('project_invalidated')];
  assert.deepEqual(new Set(moved.map((frame) => frame.event.type === 'project_invalidated'
    ? frame.event.projectId : null)), new Set([first, second]));
  assert.equal((await call(app, 'POST', `/v2/projects/${second}/items/remove`, { cookie: writer,
    body: { requestId: newRequestId('remove'), targetType: 'link', targetId } })).status, 200);
  await event(second);
  assert.equal((await call(app, 'POST', `/v2/projects/${first}/items/remove`, { cookie: writer,
    body: { requestId: newRequestId('remove-todo'), targetType: 'todo', targetId: todoId } })).status, 200);
  await event(first);
  assert.equal((await call(app, 'PUT', `/v2/projects/${first}`, { cookie: writer,
    body: { requestId: newRequestId('stale'), version: 1, name: '过时的改名' } })).status, 409);
  await assert.rejects(stream.next('project_invalidated', 60), /没等到/);
});

test('项目写入和回执一起回滚时，不向另一设备发布失效事件', async (t) => {
  app = await startTestApp();
  const cookie = await pair(app);
  const project = app.state.projects.create({ name: '原来的名字' });
  stream = await openEvents(app, cookie);
  await stream.next('ready');
  t.mock.method(app.state.apiRequests, 'save', () => { throw new Error('回执写入失败'); });
  const reply = await call(app, 'PUT', `/v2/projects/${project.id}`, { cookie,
    body: { requestId: newRequestId('rollback'), version: project.version, name: '不该提交的名字' } });
  assert.equal(reply.status, 500);
  assert.equal(app.state.projects.require(project.id).name, '原来的名字');
  await assert.rejects(stream.next('project_invalidated', 60), /没等到/);
});
