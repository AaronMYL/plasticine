import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { SoulViewSchema } from '../../shared/api/soul.ts';
import { RULES_DOC_ID } from '../../shared/state.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

test('Soul 读取要求登录，用户增改可重放、保留来源、旧版本不覆盖，撤销不物理删除', async () => {
  app = await startTestApp([], { startTasks: false });
  assert.equal((await call(app, 'GET', '/v2/soul')).status, 401);
  const cookie = await pair(app);
  const initial = await call(app, 'GET', '/v2/soul', { cookie });
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.ok(Value.Check(SoulViewSchema, initial.body));
  const input = { requestId: 'soul-add-fixture', action: 'add', text: '先核对收件人', section: 'outbound' };
  const created = await call(app, 'POST', '/v2/soul', { cookie, body: input });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(Value.Check(SoulViewSchema, created.body));
  const row = created.body.lines.find((line) => line.text === input.text)!;
  assert.equal(row.source, 'user');
  assert.equal((await call(app, 'POST', '/v2/soul', { cookie, body: input })).status, 200);
  assert.equal(app.state.memoryDocs.lines.live(RULES_DOC_ID).filter((line) => line.text === input.text).length, 1);
  assert.equal((await call(app, 'POST', '/v2/soul', { cookie,
    body: { ...input, text: '换一句' } })).status, 409);
  const edit = { requestId: 'soul-edit-fixture', action: 'edit', id: row.id, version: row.version,
    text: '发出前核对内容和收件人', section: 'outbound' };
  const updated = await call(app, 'POST', '/v2/soul', { cookie, body: edit });
  assert.ok(Value.Check(SoulViewSchema, updated.body));
  assert.equal((await call(app, 'POST', '/v2/soul', { cookie,
    body: { ...edit, requestId: 'soul-stale-fixture' } })).status, 409);
  const next = updated.body.lines.find((line) => line.text === edit.text)!;
  const undone = await call(app, 'POST', '/v2/soul', { cookie,
    body: { requestId: 'soul-undo-fixture', action: 'undo', id: next.id, version: next.version } });
  assert.ok(Value.Check(SoulViewSchema, undone.body));
  assert.ok(undone.body.lines.some((line) => line.text === input.text));
  assert.equal(app.state.memoryDocs.lines.require(next.id).retiredReason, 'no_longer_true');
  assert.equal(app.state.memoryDocs.lines.require(next.id).deletedAt, null);
});
