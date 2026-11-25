import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, pair, startTestApp } from './helpers.ts';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { lineMessagesPath, type SearchResponse } from '../../shared/api/index.ts';

test('unified search requires session, validates query/type/cursor, returns directly locatable hits', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const note = t.state.notes.create({ markdown: '# API查找\n命中后半段', folder: '笔记', author: 'user' });
    assert.equal((await call(t, 'GET', '/v2/search?q=API')).status, 401);
    const cookie = await pair(t);
    const response = await call(t, 'GET', '/v2/search?q=API&type=notes', { cookie });
    assert.equal(response.status, 200);
    const body = response.body as SearchResponse;
    assert.equal(body.results[0]?.id, note.id);
    assert.equal(body.results[0]?.kind, 'note');
    assert.equal(body.nextCursor, null);
    for (const query of ['q=', 'q=%20', 'q=API&type=unknown', 'q=API&cursor=bad', 'q=API&limit=1000']) {
      assert.equal((await call(t, 'GET', `/v2/search?${query}`, { cookie })).status, 400, query);
    }
  } finally { await t.close(); }
});

test('removed types (tasks, artifacts) are unsearchable; chat hits point to line:<id>:<seq>', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(t);
    for (const type of ['tasks', 'artifacts']) {
      assert.equal((await call(t, 'GET', `/v2/search?q=CuaDriver&type=${type}`, { cookie })).status, 400, type);
    }
    t.respond([fauxAssistantMessage('CuaDriver 是 Cua 出的一个本机驱动。')]);
    const sent = await call(t, 'POST', lineMessagesPath('main'), { cookie,
      body: { requestId: 'req-search-line-01', text: 'CuaDriver.app 是什么' } });
    assert.equal(sent.status, 200);
    await t.app.deps.lines.settled();
    const response = await call(t, 'GET', '/v2/search?q=CuaDriver&type=conversation', { cookie });
    assert.equal(response.status, 200);
    const body = response.body as SearchResponse;
    assert.deepEqual(body.results.map((result) => [result.kind, result.id, result.detail]).sort(),
      [['message', 'line:line-main:1', '你'], ['message', 'line:line-main:2', 'Plasticine']]);
  } finally { await t.close(); }
});

test('filters search by max tier and archive flag for sharing; invalid params return 400', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(t);
    const shared = t.state.notes.create({ markdown: '# 档位查找\n公开的', folder: '笔记', author: 'user' });
    t.state.notes.create({ markdown: '# 档位查找\n私密的', folder: '笔记', author: 'user' });
    t.state.visibilityMarks.put('note', shared.id, 0, { tier: 'public', proposed: null, confirmed: true });
    const all = await call(t, 'GET', '/v2/search?q=档位查找', { cookie });
    assert.equal((all.body as SearchResponse).total, 2);
    const open = await call(t, 'GET', '/v2/search?q=档位查找&maxTier=public&includeArchived=true', { cookie });
    assert.equal(open.status, 200);
    assert.deepEqual((open.body as SearchResponse).results.map((row) => row.id), [shared.id]);
    for (const query of ['maxTier=secret', 'includeArchived=yes']) {
      assert.equal((await call(t, 'GET', `/v2/search?q=档位查找&${query}`, { cookie })).status, 400, query);
    }
  } finally { await t.close(); }
});
