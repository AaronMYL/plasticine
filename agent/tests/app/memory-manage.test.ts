// 记忆改版（11-11）：加一条、挪到别处、全量整理（模型出清单，勾了才改，没勾的不动；整理不成写原因）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Value } from 'typebox/value';
import { LatestCleanupResponseSchema, MEMORY_CLEANUPS_PATH, memoryCleanupApplyPath, memoryLineMovePath,
  memoryLinesPath } from '../../shared/api/index.ts';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { addClaudeItems } from '../../src/brain/memory-cleanup.ts';
import { addLine, ensureMemoryDocs } from '../../src/brain/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

function said(app: TestApp, text: string) {
  return addLine(app.state, { docId: YOU_DOC_ID, text, basis: 'stated', anchors: [{ kind: 'message', ref: 'msg-1' }] },
    { actor: 'brain', ref: 'run' });
}

async function latest(app: TestApp, cookie: string) {
  const body = json(await call(app, 'GET', `${MEMORY_CLEANUPS_PATH}/latest`, { cookie }));
  assert.ok(Value.Check(LatestCleanupResponseSchema, body));
  return body;
}

test('加一条是你说的；挪到别的文档：原来那行进归档，那份最后多一条', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  const doc = t.state.memoryDocs.docs.create({ kind: 'topic', title: '生活', summary: '', createdBy: 'user' });
  const added = await call(t, 'POST', memoryLinesPath(YOU_DOC_ID), { cookie,
    body: { requestId: 'add-line-1', text: '周末去爬山。' } });
  assert.equal(added.status, 201);
  const line = t.state.memoryDocs.lines.live(YOU_DOC_ID).find((item) => item.text === '周末去爬山。')!;
  assert.equal(line.basis, 'stated');
  const moved = await call(t, 'POST', memoryLineMovePath(YOU_DOC_ID, line.id), { cookie,
    body: { requestId: 'move-line-1', version: line.version, toDocId: doc.id } });
  assert.equal(moved.status, 200);
  assert.notEqual(t.state.memoryDocs.lines.require(line.id).archivedAt, null);
  assert.deepEqual(t.state.memoryDocs.lines.live(doc.id).map((item) => item.text), ['周末去爬山。']);
});

test('全量整理：模型出清单和总览，勾了的才改；Claude 带进来的新加条目在最前、不注明来处', async () => {
  const lines: string[] = [];
  const answer = (text: string) => Promise.resolve({ text, complete: true });
  t = await startTestApp([async (request) => {
    const text = String(request.messages[0]?.content ?? '');
    if (request.system?.includes('互相矛盾') === true) return answer('{"conflicts":[]}');
    const material = JSON.parse(text) as { lines: { id: string; text: string }[] };
    const id = (wanted: string) => material.lines.find((line) => line.text === wanted)?.id;
    const ids = [id('每周健身三次'), id('一周去三次健身房'), id('在找二手 Mac mini')];
    lines.push(...ids.map(String));
    return answer(JSON.stringify({ overview: 'Alex，独立开发者。', items: [
      { kind: 'merge', lines: [ids[0], ids[1]], text: '每周健身三次。', reason: '说的是一回事' },
      { kind: 'archive', lines: [ids[2]], reason: '过时了' },
      { kind: 'rewrite', lines: ['not-a-line'], text: '不该出现', reason: '编的行' },
    ] }));
  }]);
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  said(t, '每周健身三次');
  said(t, '一周去三次健身房');
  const old = said(t, '在找二手 Mac mini');
  addClaudeItems(t.state, [{ toDocId: YOU_DOC_ID, text: '住在成都。', reason: '' }]);
  assert.equal((await call(t, 'POST', MEMORY_CLEANUPS_PATH, { cookie, body: { requestId: 'cleanup-1' } })).status, 202);
  let body = await latest(t, cookie);
  for (let i = 0; i < 50 && body.cleanup?.status === 'running'; i += 1) {
    await sleep(20);
    body = await latest(t, cookie);
  }
  assert.equal(body.cleanup?.status, 'ready', body.cleanup?.error ?? '');
  assert.equal(body.overview?.text, 'Alex，独立开发者。');
  assert.deepEqual(body.cleanup!.items.map((item) => item.kind), ['add', 'merge', 'archive']);
  assert.equal(body.cleanup!.items[0]!.reason, '');
  const [add, merge] = body.cleanup!.items;
  const applied = await call(t, 'POST', memoryCleanupApplyPath(body.cleanup!.id), { cookie,
    body: { requestId: 'apply-list-1', version: body.cleanup!.version, itemIds: [add!.id, merge!.id] } });
  assert.equal(applied.status, 200);
  assert.deepEqual([json(applied).applied, json(applied).skipped], [2, 1]);
  const texts = t.state.memoryDocs.lines.live(YOU_DOC_ID).map((item) => item.text);
  assert.ok(texts.includes('每周健身三次。'));
  assert.ok(texts.includes('住在成都。'));
  assert.ok(texts.includes('在找二手 Mac mini'));
  assert.equal(t.state.memoryDocs.lines.require(old.id).retiredAt, null);
  const again = await call(t, 'POST', memoryCleanupApplyPath(body.cleanup!.id), { cookie,
    body: { requestId: 'apply-list-2', version: (json(applied) as { cleanup: { version: number } }).cleanup.version,
      itemIds: [] } });
  assert.equal(again.status, 409);
});

test('整理不成：记下原因，下次能再整理', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  said(t, '一行');
  await call(t, 'POST', MEMORY_CLEANUPS_PATH, { cookie, body: { requestId: 'cleanup-1' } });
  let body = await latest(t, cookie);
  for (let i = 0; i < 50 && body.cleanup?.status === 'running'; i += 1) {
    await sleep(20);
    body = await latest(t, cookie);
  }
  assert.equal(body.cleanup?.status, 'failed');
  assert.ok((body.cleanup?.error ?? '') !== '');
  assert.equal((await call(t, 'POST', MEMORY_CLEANUPS_PATH, { cookie, body: { requestId: 'cleanup-2' } })).status, 202);
});
