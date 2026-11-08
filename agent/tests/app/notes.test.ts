import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { currentAssetUrl } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
let cookie: string;
let counter = 0;

beforeEach(async () => {
  t = await startTestApp();
  cookie = await pair(t);
});

afterEach(async () => {
  await t.close();
});

function requestId(): string {
  counter += 1;
  return `req-note-${String(counter).padStart(6, '0')}`;
}

test('恢复历史正文另存新版本，来源可查，重复请求不多存，篡改历史内容被拒绝', async () => {
  const note = await create('第一版');
  const id = String(note['id']);
  await call(t, 'PUT', `/v2/notes/${id}`, {
    cookie, body: { requestId: requestId(), version: 1, markdown: '第二版' },
  });
  const wrong = await call(t, 'PUT', `/v2/notes/${id}`, {
    cookie, body: { requestId: requestId(), version: 2, markdown: '不是第一版', restoredFromVersion: 1 },
  });
  assert.equal(wrong.status, 400);
  const body = { requestId: requestId(), version: 2, markdown: '第一版', restoredFromVersion: 1 };
  const restored = await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body });
  assert.equal(restored.status, 200);
  assert.equal(json(restored)['version'], 3);
  assert.deepEqual((await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body })).body, restored.body);
  const history = json(await call(t, 'GET', `/v2/notes/${id}/versions`, { cookie }));
  const versions = history['versions'] as Array<Record<string, unknown>>;
  assert.equal(versions.length, 3);
  assert.equal(versions[0]?.['restoredFromVersion'], 1);
  assert.equal(versions[0]?.['characters'], 3);
  assert.equal(t.state.notes.readVersion(id, 2)?.markdown, '第二版');
});

test('私密笔记的正文、标题、全文搜索和历史由配对会话直接读取，无逐篇解锁', async () => {
  const markdown = '# 阅读随记\n私密正文\n' + '前文'.repeat(150) + '深处的线索';
  const note = t.state.notes.create({ markdown, folder: '笔记', author: 'user', private: true });
  t.clock.advance(20 * 60_000);
  for (const suffix of ['', '/versions', '/versions/1']) {
    const response = await call(t, 'GET', `/v2/notes/${note.id}${suffix}`, { cookie });
    assert.equal(response.status, 200, suffix);
  }
  const list = json(await call(t, 'GET', '/v2/notes', { cookie }));
  const listed = (list['notes'] as Record<string, unknown>[])[0]!;
  assert.equal(listed['title'], '阅读随记');
  assert.match(String(listed['preview']), /私密正文/);
  assert.equal(listed['private'], true);
  assert.equal(listed['readOnly'], false);
  const found = json(await call(t, 'GET', '/v2/notes?q=深处的线索', { cookie }));
  assert.deepEqual((found['notes'] as { id: string }[]).map((row) => row.id), [note.id]);
  const other = await pair(t);
  const read = await call(t, 'GET', `/v2/notes/${note.id}`, { cookie: other });
  assert.equal(read.status, 200);
  assert.equal(json(read)['markdown'], markdown);
  assert.deepEqual(t.state.notes.require(note.id), note);
});

async function create(markdown = '# 周末\n去西湖') {
  const reply = await call(t, 'POST', '/v2/notes', { cookie, body: { requestId: requestId(), markdown } });
  assert.equal(reply.status, 201);
  return json(reply);
}

test('新建一篇 201：正文、标题、版本 1、默认文件夹「笔记」', async () => {
  const note = await create();
  assert.equal(note['markdown'], '# 周末\n去西湖');
  assert.equal(note['title'], '周末');
  assert.equal(note['version'], 1);
  assert.equal(note['folder'], '笔记');
  const one = json(await call(t, 'GET', `/v2/notes/${String(note['id'])}`, { cookie }));
  assert.equal(one['markdown'], '# 周末\n去西湖');
});

test('保存带对的版本：200、版本加一', async () => {
  const note = await create();
  const id = String(note['id']);
  const body = { requestId: requestId(), version: 1, markdown: '# 周末\n改去灵隐寺' };
  const saved = await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body });
  assert.equal(saved.status, 200);
  assert.equal(json(saved)['version'], 2);
  assert.equal(json(saved)['markdown'], '# 周末\n改去灵隐寺');
});

test('保存时版本对不上 409：带当前版本号和当前全文，正文不被覆盖', async () => {
  const note = await create();
  const id = String(note['id']);
  await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body: { requestId: requestId(), version: 1, markdown: '另一台改的' } });
  const stale = { requestId: requestId(), version: 1, markdown: '旧版本上的改动' };
  const conflict = await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body: stale });
  assert.equal(conflict.status, 409);
  const body = json(conflict);
  assert.equal(body['code'], 'version_conflict');
  assert.equal(body['currentVersion'], 2);
  const current = body['current'] as Record<string, unknown>;
  assert.equal(current['markdown'], '另一台改的');
  assert.equal(current['version'], 2);
  const read = json(await call(t, 'GET', `/v2/notes/${id}`, { cookie }));
  assert.equal(read['markdown'], '另一台改的');
});

test('同一个保存请求重发：回放同一个结果，不再加版本', async () => {
  const note = await create();
  const id = String(note['id']);
  const body = { requestId: requestId(), version: 1, markdown: '改一次' };
  const first = await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body });
  const again = await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body });
  assert.deepEqual(again.body, first.body);
  assert.equal(t.state.notes.get(id)?.version, 2);
});

test('删除只打删除时间：列表里不见了，但还能按 id 读到，文件还在', async () => {
  const note = await create();
  const id = String(note['id']);
  const deleted = await call(t, 'DELETE', `/v2/notes/${id}`, { cookie, body: { requestId: requestId() } });
  assert.equal(deleted.status, 200);
  assert.notEqual(json(deleted)['deletedAt'], null);
  const list = json(await call(t, 'GET', '/v2/notes', { cookie }));
  assert.deepEqual(list['notes'], []);
  const withDeleted = json(await call(t, 'GET', '/v2/notes?includeDeleted=true', { cookie }));
  assert.equal((withDeleted['notes'] as unknown[]).length, 1);
  assert.equal(json(await call(t, 'GET', `/v2/notes/${id}`, { cookie }))['markdown'], '# 周末\n去西湖');
});

test('列表分页：nextOffset 指向下一页', async () => {
  for (let index = 0; index < 3; index += 1) {
    await create(`第 ${index} 篇`);
  }
  const page = json(await call(t, 'GET', '/v2/notes?limit=2', { cookie }));
  assert.equal((page['notes'] as unknown[]).length, 2);
  assert.equal(page['nextOffset'], 2);
  const rest = json(await call(t, 'GET', '/v2/notes?limit=2&offset=2', { cookie }));
  assert.equal((rest['notes'] as unknown[]).length, 1);
  assert.equal(rest['nextOffset'], null);
});

test('请求体不对 400：缺 version 说是哪个字段', async () => {
  const note = await create();
  const reply = await call(t, 'PUT', `/v2/notes/${String(note['id'])}`, { cookie, body: { requestId: requestId() } });
  assert.equal(reply.status, 400);
  assert.match(String(json(reply)['error']), /version/);
});

test('图片按名字读；旧路径能换成新路径', async () => {
  const assets = join(t.directory, 'notes', 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, '0123456789abcdef.png'), Buffer.from([137, 80, 78, 71]));
  const reply = await call(t, 'GET', '/v2/notes/assets/0123456789abcdef.png', { cookie });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('content-type'), 'image/png');
  assert.equal((await call(t, 'GET', '/v2/notes/assets/missing000000000.png', { cookie })).status, 404);
  assert.equal(currentAssetUrl('/v1/notes/assets/a.png'), '/v2/notes/assets/a.png');
  assert.equal(currentAssetUrl('https://example.com/x.png'), 'https://example.com/x.png');
});

test('不存在的笔记 404', async () => {
  assert.equal((await call(t, 'GET', '/v2/notes/nope', { cookie })).status, 404);
});

test('笔记原文经新建、读取、草稿保存、冲突和回执重放逐字返回，编辑器读回再存不改正文', async () => {
  const markdown = '# //todo 10:30@会议室\nhttps://x.example/?token=abc\na:b@c';
  const note = await create(markdown);
  const path = `/v2/notes/${String(note['id'])}`;
  assert.equal(note['markdown'], markdown);
  const read = json(await call(t, 'GET', path, { cookie }));
  assert.equal(read['markdown'], markdown);
  assert.equal(read['title'], '//todo 10:30@会议室');
  assert.ok(String(read['preview']).includes('https://x.example/?token=abc'));
  const list = json(await call(t, 'GET', '/v2/notes', { cookie }));
  assert.equal((list['notes'] as Record<string, unknown>[])[0]?.['preview'], read['preview']);
  const body = { requestId: requestId(), version: 1, markdown: read['markdown'] };
  const saved = await call(t, 'PUT', path, { cookie, body });
  assert.equal(saved.status, 200);
  assert.equal(json(saved)['markdown'], markdown);
  const replay = await call(t, 'PUT', path, { cookie, body });
  assert.deepEqual(replay.body, saved.body);
  const draft = `${markdown}\n草稿 https://u:p@x.example/?token=abc`;
  const next = await call(t, 'PUT', path, { cookie, body: {
    requestId: requestId(), version: json(saved)['version'], markdown: draft,
  } });
  assert.equal(next.status, 200);
  assert.equal(json(next)['markdown'], draft);
  const conflict = await call(t, 'PUT', path, { cookie, body: {
    requestId: requestId(), version: 1, markdown: '旧版的草稿',
  } });
  assert.equal(conflict.status, 409);
  assert.equal((json(conflict)['current'] as Record<string, unknown>)['markdown'], draft);
  assert.equal(t.state.notes.readBody(t.state.notes.require(String(note['id']))), draft);
});
