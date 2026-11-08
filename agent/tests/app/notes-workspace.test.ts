import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NOTE_IMAGE_MAX_BYTES } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
let cookie: string;
beforeEach(async () => { t = await startTestApp([('接下来的一句')]); cookie = await pair(t); });
afterEach(async () => { await t.close(); });

function note(markdown = '# 原文\n正文', folder = '笔记') {
  return t.state.notes.create({ markdown, folder, author: 'user' });
}

test('HTTP 文件夹重命名、回收站读取和重复恢复保持同一篇笔记', async () => {
  const original = note('# 出行\n正文', '旅行');
  const rename = { requestId: 'folder-rename-0001', action: 'rename', name: '旅行', next: '出行' };
  assert.equal((await call(t, 'POST', '/v2/notes/folders', { cookie, body: rename })).status, 200);
  assert.equal((await call(t, 'POST', '/v2/notes/folders', { cookie, body: rename })).status, 200);
  await call(t, 'DELETE', `/v2/notes/${original.id}`, { cookie, body: { requestId: 'note-delete-0001' } });
  const deleted = await json(await call(t, 'GET', '/v2/notes?deletedOnly=true', { cookie }));
  assert.equal((deleted['notes'] as unknown[]).length, 1);
  const request = { cookie, body: { requestId: 'note-restore-0001' } };
  const first = await json(await call(t, 'POST', `/v2/notes/${original.id}/restore`, request));
  const second = await json(await call(t, 'POST', `/v2/notes/${original.id}/restore`, request));
  assert.deepEqual(first, second);
  assert.equal(first['folder'], '出行');
  assert.equal(first['deletedAt'], null);
});

test('HTTP 正文搜索先匹配再分页，默认响应不带全文', async () => {
  const matched = note(`# 标题\n${'普通内容'.repeat(60)}\n深处的线索`);
  note('# 不匹配');
  const result = await json(await call(t, 'GET', '/v2/notes?q=线索&limit=1', { cookie }));
  const list = result['notes'] as { id: string; markdown?: string }[];
  assert.equal(list[0]?.id, matched.id);
  assert.equal(list[0]?.markdown, undefined);
  assert.equal(result['nextOffset'], null);
});

test('图片上传按内容保存，重复请求回放同一链接，10 MB边界有效', async () => {
  const current = note();
  const data = Buffer.from('isolated image content');
  const request = { cookie, body: { requestId: 'note-image-0001', type: 'image/png', data: data.toString('base64') } };
  const uploaded = await json(await call(t, 'POST', `/v2/notes/${current.id}/images`, request));
  assert.deepEqual(await json(await call(t, 'POST', `/v2/notes/${current.id}/images`, request)), uploaded);
  const response = await call(t, 'GET', String(uploaded['url']), { cookie });
  assert.equal(response.status, 200);
  assert.equal(Buffer.from(response.body as ArrayBuffer).toString(), data.toString());
  assert.equal(t.state.notes.writeAsset(Buffer.alloc(NOTE_IMAGE_MAX_BYTES, 1), 'image/png').bytes, NOTE_IMAGE_MAX_BYTES);
  assert.throws(() => t.state.notes.writeAsset(Buffer.alloc(NOTE_IMAGE_MAX_BYTES + 1, 1), 'image/png'), /10 MB/);
});

test('笔记AI返回建议，服务器不擅自改正文或加版本', async () => {
  const current = note();
  const response = await call(t, 'POST', `/v2/notes/${current.id}/assist`, {
    cookie, body: { action: 'predict', markdown: '# 原文\n正文' },
  });
  assert.equal(response.status, 200);
  assert.equal((await json(response))['markdown'], '接下来的一句');
  assert.equal(t.state.notes.require(current.id).version, 1);
  assert.equal(t.state.notes.readBody(current), '# 原文\n正文');
});
