import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MateViewSchema, MateGroupViewSchema, MateListResponseSchema } from '../../shared/api/mates.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';
import { until } from '../lines/helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const draft = { name: '资料研究员', role: '整理公开资料', avatar: '研', hue: 'sky', soul: '先读原始资料。', purpose: null };

test('模型建立队友先出确认卡，本人确认后只建一位', async () => {
  app = await startTestApp([], { startTasks: false });
  const cookie = await pair(app);
  app.respond([
    fauxAssistantMessage([fauxToolCall('mate_create', draft, { id: 'mate-create-confirm-fixture' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('队友已建立。'),
  ]);
  app.app.deps.lines.send('main', { text: '建立一位资料研究员' });
  await until(() => app!.state.asks.open().length === 1, '出现建立确认卡');
  assert.equal(app.state.mates.all().length, 0);
  const ask = app.state.asks.open()[0]!;
  const answer = await call(app, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: 'confirm-mate-create', optionId: 'allow' } });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await app.app.deps.lines.settled();
  assert.equal(app.state.mates.all().length, 1);
  assert.equal(app.state.mates.all()[0]?.role, draft.role);
});

test('队友接口要求登录，创建重发不重复，改动确认内容拒绝，编辑检查版本', async () => {
  app = await startTestApp([], { startTasks: false });
  assert.equal((await call(app, 'GET', '/v2/mates')).status, 401);
  const cookie = await pair(app);
  const body = { requestId: 'mate-create-fixture', ...draft };
  const created = await call(app, 'POST', '/v2/mates', { cookie, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(Value.Check(MateViewSchema, created.body));
  const mate = created.body;
  assert.equal((await call(app, 'POST', '/v2/mates', { cookie, body })).status, 201);
  assert.equal(app.state.mates.all().length, 1);
  assert.equal((await call(app, 'POST', '/v2/mates', { cookie,
    body: { ...body, role: '另一份职责' } })).status, 409);
  const list = await call(app, 'GET', '/v2/mates', { cookie });
  assert.ok(Value.Check(MateListResponseSchema, list.body));
  assert.equal(list.body.mates[0]?.lineId, mate.lineId);
  const changed = await call(app, 'PATCH', `/v2/mates/${mate.id}`, { cookie,
    body: { requestId: 'mate-edit-fixture', version: mate.version, soul: '先列提纲。', disabled: true } });
  assert.equal(changed.status, 200);
  assert.ok(Value.Check(MateViewSchema, changed.body));
  assert.notEqual(changed.body.disabledAt, null);
  assert.equal((await call(app, 'PATCH', `/v2/mates/${mate.id}`, { cookie,
    body: { requestId: 'mate-stale-fixture', version: mate.version, role: '修改职责' } })).status, 409);
  assert.equal((await call(app, 'POST', `/v2/lines/${mate.lineId}/messages`, { cookie,
    body: { requestId: 'mate-disabled-message', text: '开始' } })).status, 409);
});

test('群组严格要求2至6位在用成员；旧对话并入保留消息、时间和原始身份', async () => {
  app = await startTestApp([], { startTasks: false });
  const cookie = await pair(app);
  const first = await call(app, 'POST', '/v2/mates', { cookie,
    body: { requestId: 'mate-one-fixture', ...draft } });
  const second = await call(app, 'POST', '/v2/mates', { cookie,
    body: { requestId: 'mate-two-fixture', ...draft, name: '文字编辑' } });
  assert.ok(Value.Check(MateViewSchema, first.body));
  assert.ok(Value.Check(MateViewSchema, second.body));
  const invalid = await call(app, 'POST', '/v2/mate-groups', { cookie,
    body: { requestId: 'group-invalid-fixture', name: '写作小组', mateIds: [first.body.id, first.body.id] } });
  assert.equal(invalid.status, 400);
  const group = await call(app, 'POST', '/v2/mate-groups', { cookie,
    body: { requestId: 'group-valid-fixture', name: '写作小组', mateIds: [first.body.id, second.body.id] } });
  assert.ok(Value.Check(MateGroupViewSchema, group.body));
  const old = app.app.deps.lines.openSide({ title: '资料归纳', topic: null });
  const original = app.state.lineMessages.append(old.id, 'user',
    { role: 'user', content: '请整理这些资料', timestamp: 1000 },
    { origin: { kind: 'user', userText: '请整理这些资料' } });
  const merged = await call(app, 'POST', '/v2/mates/legacy/convert', { cookie,
    body: { requestId: 'legacy-merge-fixture', lineId: old.id, action: 'merge' } });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const copied = app.state.lineMessages.last('line-main');
  assert.deepEqual(copied?.message, original.message);
  assert.equal(copied?.createdAt, original.createdAt);
  assert.equal(copied?.meta?.origin?.kind, 'user');
  assert.equal(copied?.meta?.origin?.ref, `line:${old.id}:1`);
  assert.notEqual(app.state.lines.require(old.id).archivedAt, null);
  assert.equal(app.state.lineMessages.after(old.id, 0).length, 1);
  assert.equal((await call(app, 'POST', '/v2/mates/legacy/convert', { cookie,
    body: { requestId: 'legacy-merge-again', lineId: old.id, action: 'merge' } })).status, 409);
});
