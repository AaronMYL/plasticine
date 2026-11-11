import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { ConflictListResponseSchema, MEMORY_CONFLICTS_PATH, memoryConflictPath } from '../../shared/api/index.ts';
import { RULES_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs } from '../../src/brain/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

test('说法冲突：要登录；留下一条时另一条进归档、冲突关掉；定过的再定是冲突', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const { state } = t;
  ensureMemoryDocs(state);
  const said = addLine(state, { docId: YOU_DOC_ID, text: '周末照常提醒到期事项', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-1' }] }, { actor: 'brain', ref: 'run' });
  const system = state.memoryDocs.lines.live(RULES_DOC_ID)[0]!;
  const conflict = state.memoryConflicts.create({ title: '周末的提醒', lineIds: [said.id, system.id] });
  assert.equal((await call(t, 'GET', MEMORY_CONFLICTS_PATH, {})).status, 401);
  const listed = json(await call(t, 'GET', MEMORY_CONFLICTS_PATH, { cookie }));
  assert.ok(Value.Check(ConflictListResponseSchema, listed));
  assert.equal(listed.conflicts[0]?.lines.find((line) => line.id === said.id)?.source, 'said');
  const body = { requestId: 'resolve-1', version: conflict.version, resolution: 'kept', keepLineId: system.id };
  const resolved = await call(t, 'POST', `${memoryConflictPath(conflict.id)}/resolve`, { cookie, body });
  assert.equal(resolved.status, 200);
  assert.deepEqual(json(resolved).conflicts, []);
  assert.notEqual(state.memoryDocs.lines.require(said.id).archivedAt, null);
  assert.equal(state.memoryDocs.lines.require(system.id).retiredAt, null);
  const again = await call(t, 'POST', `${memoryConflictPath(conflict.id)}/resolve`, { cookie,
    body: { ...body, requestId: 'resolve-2' } });
  assert.equal(again.status, 409);
});
