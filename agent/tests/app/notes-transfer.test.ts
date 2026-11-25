import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openZip } from '../../src/util/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await startTestApp([], { startTasks: false });
  cookie = await pair(t);
});
afterEach(async () => {
  await t.close();
});

const file = (name: string, text: string) => ({ name, contentBase64: Buffer.from(text, 'utf8').toString('base64') });

test('note import creates notes in target folder with failure reasons; same requestId is idempotent', async () => {
  const body = { requestId: 'req_import_notes_1', folder: '读书',
    files: [file('第一篇.md', '# 第一篇\n\n正文'), file('随手记.txt', '一行\n两行'), file('表格.csv', 'a,b')] };
  const reply = await call(t, 'POST', '/v2/notes/import', { cookie, body });
  assert.equal(reply.status, 200);
  const result = json(reply);
  const imported = result['imported'] as { id: string; title: string; folder: string; author: string }[];
  assert.deepEqual(imported.map((note) => [note.title, note.folder, note.author]),
    [['第一篇', '读书', 'user'], ['随手记', '读书', 'user']]);
  assert.deepEqual(result['skipped'], [{ name: '表格.csv', reason: '不是 .md 或 .txt 文件' }]);
  assert.equal(json(await call(t, 'GET', `/v2/notes/${imported[1]!.id}`, { cookie }))['markdown'], '# 随手记\n\n一行\n\n两行');
  const again = await call(t, 'POST', '/v2/notes/import', { cookie, body });
  assert.deepEqual(json(again), result);
  assert.equal(t.state.notes.list({}, { limit: 10 }).length, 2);
});

test('note import rejects non-base64 content, empty file list, and unauthenticated requests', async () => {
  const bad = await call(t, 'POST', '/v2/notes/import', { cookie,
    body: { requestId: 'req_import_bad', files: [{ name: 'a.md', contentBase64: '不是 base64' }] } });
  assert.equal(bad.status, 400);
  const empty = await call(t, 'POST', '/v2/notes/import',
    { cookie, body: { requestId: 'req_import_none', files: [] } });
  assert.equal(empty.status, 400);
  const anonymous = await call(t, 'POST', '/v2/notes/import',
    { body: { requestId: 'req_import_anon', files: [file('a.md', '# a')] } });
  assert.equal(anonymous.status, 401);
  assert.equal(t.state.notes.list({}, { limit: 10 }).length, 0);
});

test('note export: single as .md with filename header, multiple as zip; 404 missing, 401 unauth', async () => {
  const first = t.state.notes.create({ markdown: '# 周末计划\n\n去西湖', folder: '笔记', author: 'user' });
  const second = t.state.notes.create({ markdown: '# 周报\n\n这周', folder: '工作', author: 'user' });
  const one = await call(t, 'POST', '/v2/notes/export', { cookie, body: { ids: [first.id] } });
  assert.equal(one.status, 200);
  assert.equal(one.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(one.headers.get('content-disposition'),
    `attachment; filename*=UTF-8''${encodeURIComponent('周末计划.md')}`);
  assert.match(Buffer.from(one.body as ArrayBuffer).toString('utf8'), /^---\ncreated: .+\nupdated: .+\n---\n\n# 周末计划/);
  const both = await call(t, 'POST', '/v2/notes/export', { cookie, body: { ids: [first.id, second.id] } });
  assert.equal(both.headers.get('content-type'), 'application/zip');
  assert.deepEqual(openZip(Buffer.from(both.body as ArrayBuffer))?.names().sort(), ['工作/周报.md', '笔记/周末计划.md']);
  assert.equal((await call(t, 'POST', '/v2/notes/export', { cookie, body: { ids: ['missing'] } })).status, 404);
  assert.equal((await call(t, 'POST', '/v2/notes/export', { body: { ids: [first.id] } })).status, 401);
});
