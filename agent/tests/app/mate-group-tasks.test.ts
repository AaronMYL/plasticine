import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { ListLinesResponseSchema } from '../../shared/api/lines.ts';
import { MateHandoffResponseSchema } from '../../shared/api/mates.ts';
import { Mates } from '../../src/mates/service.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

test('群任务接口沿用线 schema，未登录不可读写，发布重放和归档后重试都不重复创建', async () => {
  app = await startTestApp([], { startTasks: false });
  const mates = new Mates(app.state, () => app!.app.deps.lines);
  const draft = { name: '资料研究员', role: '整理公开资料', avatar: '研', hue: 'sky' as const,
    soul: '核对来源。', purpose: null };
  const a = mates.create(draft);
  const b = mates.create({ ...draft, name: '文字编辑' });
  const group = mates.createGroup({ name: '资料小组', mateIds: [a.id, b.id] });
  const path = `/v2/mate-groups/${group.id}/tasks`;
  assert.equal((await call(app, 'GET', path)).status, 401);
  const body = { requestId: 'group-task-offer-fixture', text: '核对资料，交付完整摘要。' };
  assert.equal((await call(app, 'POST', path, { body })).status, 401);
  const cookie = await pair(app);
  assert.equal((await call(app, 'POST', path, { cookie,
    body: { ...body, requestId: 'group-task-reply-fixture', replyTo: { seq: 1 } } })).status, 400);
  assert.equal((await call(app, 'POST', path, { cookie, body: { ...body, requestId: 'group-task-quote-fixture',
    quotes: [{ kind: 'text', label: '测试摘录', text: '虚构正文' }] } })).status, 400);
  const first = await call(app, 'POST', path, { cookie, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.ok(Value.Check(MateHandoffResponseSchema, first.body));
  const task = first.body.line;
  assert.equal(task.status, 'paused');
  assert.equal(task.mateId, null);
  const before = app.state.lineMessages.after(task.id, 0).length;
  const bypass = await call(app, 'POST', `/v2/lines/${task.id}/messages`, { cookie,
    body: { requestId: 'group-task-no-at-bypass', text: `@${a.name} 直接开始执行` } });
  assert.equal(bypass.status, 409, JSON.stringify(bypass.body));
  assert.equal(app.state.lineMessages.after(task.id, 0).length, before);
  assert.equal(app.app.deps.lines.read(task.id, 10).queue.length, 1);
  assert.equal(app.state.lines.list({ kind: 'background', includeArchived: true, limit: 20 }).length, 1);
  assert.equal((await call(app, 'POST', path, { cookie, body })).status, 201);
  assert.equal((await call(app, 'POST', path, { cookie, body: { ...body, text: '换一个目标' } })).status, 409);
  const listed = await call(app, 'GET', path, { cookie });
  assert.ok(Value.Check(ListLinesResponseSchema, listed.body));
  assert.deepEqual(listed.body.lines.map((line) => line.id), [task.id]);
  assert.equal((await call(app, 'POST', `/v2/lines/${task.id}/resume`, { cookie,
    body: { requestId: 'group-task-no-retry' } })).status, 409);
  app.app.deps.lines.archive(task.id);
  assert.equal((await call(app, 'POST', path, { cookie, body })).status, 201);
  assert.notEqual(app.state.lines.require(task.id).archivedAt, null);
  assert.equal(app.state.lines.list({ kind: 'background', includeArchived: true, limit: 20 }).length, 1);
});
