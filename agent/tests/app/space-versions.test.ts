import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('空间版本记录只读，按选中的版本返回原文并保留当前版本', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const cookie = await pair(app);
  const space = app.state.spaces.create({ title: '版本记录', doc: EMPTY_SPACE_DOC, genre: 'report',
    html: '<p>第一版</p>', author: 'ai' });
  app.state.spaces.save(space.id, 1, { html: '<p>第二版</p>' }, 'user', { change: '改了一段' });
  const path = `/v2/spaces/${space.id}/versions`;
  assert.equal((await call(app, 'GET', path)).status, 401);
  const reply = await call(app, 'GET', `${path}?version=1`, { cookie });
  assert.equal(reply.status, 200);
  assert.deepEqual((json(reply)['versions'] as { version: number }[]).map((row) => row.version), [2, 1]);
  assert.equal((json(reply)['selected'] as { html: string }).html, '<p>第一版</p>');
  assert.equal(app.state.spaces.require(space.id).version, 2);
  assert.equal((await call(app, 'GET', `${path}?version=99`, { cookie })).status, 404);
  app.state.spaces.markDeleted(space.id, 2);
  app.state.libraryPurge.space(space.id);
  assert.equal((await call(app, 'GET', path, { cookie })).status, 404);
});
