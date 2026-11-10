import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { BrowserSessions } from '../../src/app/browser-sessions.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('资料库批量回收逐项报告，重复请求不重复操作，清空数量变化先拒绝', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const space = app.state.spaces.create({ title: '第一份报告', doc: EMPTY_SPACE_DOC, author: 'ai' });
  const path = '/v2/library/batch';
  const moved = await call(app, 'POST', path, { cookie, body: { requestId: 'batch-move-1',
    action: 'move', destination: '项目资料', items: [{ kind: 'space', id: space.id }] } });
  assert.equal((json(moved)['results'] as { ok: boolean }[])[0]?.ok, true);
  assert.equal(app.state.spaces.require(space.id).folder, '项目资料');
  const body = { requestId: 'batch-trash-1', action: 'trash',
    items: [{ kind: 'space', id: space.id }, { kind: 'space', id: 'missing-space' }] };
  assert.equal((await call(app, 'POST', path, { body })).status, 401);
  const reply = await call(app, 'POST', path, { cookie, body });
  assert.equal(reply.status, 200);
  const results = json(reply)['results'] as { ok: boolean; error: string | null }[];
  assert.deepEqual(results.map((item) => item.ok), [true, false]);
  assert.ok(results[1]?.error);
  assert.deepEqual(json(await call(app, 'POST', path, { cookie, body })), json(reply));
  const empty = '/v2/library/trash/empty';
  assert.equal((await call(app, 'POST', empty, { cookie,
    body: { requestId: 'empty-stale', expectCount: 2 } })).status, 409);
  assert.equal(app.state.spaces.deleted().length, 1);
  assert.equal((await call(app, 'POST', empty, { cookie,
    body: { requestId: 'empty-current', expectCount: 1 } })).status, 200);
  assert.equal(app.state.spaces.get(space.id), undefined);
  assert.deepEqual(json(await call(app, 'GET', '/v2/library/trash', { cookie }))['items'], []);
});

test('笔记批量移动、回收、还原与永久删除共用逐项结果', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const note = app.state.notes.create({ markdown: '# 一篇笔记', folder: '收件', author: 'user' });
  const items = [{ kind: 'note', id: note.id }];
  for (const action of ['move', 'trash', 'restore', 'trash']) {
    const result = await call(app, 'POST', '/v2/notes/batch', { cookie,
      body: { requestId: `note-${action}-${app.state.notes.require(note.id).version}`, action, items,
        ...(action === 'move' ? { destination: '读书' } : {}) } });
    assert.equal(result.status, 200);
    assert.equal((json(result)['results'] as { ok: boolean }[])[0]?.ok, true);
  }
  assert.equal(app.state.notes.require(note.id).folder, '读书');
  assert.equal((await call(app, 'POST', '/v2/notes/trash/empty', { cookie,
    body: { requestId: 'notes-empty', expectCount: 1 } })).status, 200);
  assert.equal(app.state.notes.get(note.id), undefined);
});

test('内部浏览器不能绕过确认直接永久删除或清空，普通回收仍可操作', async (t) => {
  const app = await startTestApp([], { startTasks: false });
  t.after(() => app.close());
  await pair(app);
  const session = new BrowserSessions(app.state, app.clock.now).open();
  const cookie = session.cookie.split(';')[0]!;
  const note = app.state.notes.create({ markdown: '# 待清理笔记', folder: '收件', author: 'user' });
  const space = app.state.spaces.create({ title: '待清理报告', doc: EMPTY_SPACE_DOC, author: 'ai' });
  const cases = [
    { path: '/v2/notes', items: [{ kind: 'note', id: note.id }] },
    { path: '/v2/library', items: [{ kind: 'space', id: space.id }] },
  ];
  for (const [index, entry] of cases.entries()) {
    const trashed = await call(app, 'POST', `${entry.path}/batch`, { cookie,
      body: { requestId: `system-trash-${index}`, action: 'trash', items: entry.items } });
    assert.equal(json(trashed).succeeded, 1);
    const purged = await call(app, 'POST', `${entry.path}/batch`, { cookie,
      body: { requestId: `system-purge-${index}`, action: 'purge', items: entry.items } });
    assert.equal(purged.status, 403);
    const emptied = await call(app, 'POST', `${entry.path}/trash/empty`, { cookie,
      body: { requestId: `system-empty-${index}`, expectCount: 1 } });
    assert.equal(emptied.status, 403);
  }
  assert.ok(app.state.notes.get(note.id));
  assert.ok(app.state.spaces.get(space.id));
});

test('永久删除新请求重试已清空的同一条目仍返回成功，未知条目仍报告失败', async (t) => {
  const app = await startTestApp([], { startTasks: false });
  t.after(() => app.close());
  const cookie = await pair(app);
  const note = app.state.notes.create({ markdown: '# 重试笔记', folder: '收件', author: 'user' });
  app.state.notes.markDeleted(note.id);
  for (const requestId of ['purge-first', 'purge-retry']) {
    const result = await call(app, 'POST', '/v2/notes/batch', { cookie, body: { requestId, action: 'purge',
      items: [{ kind: 'note', id: note.id }, { kind: 'note', id: 'missing-note' }] } });
    assert.equal(json(result).succeeded, 1);
    assert.equal(json(result).failed, 1);
  }
});
