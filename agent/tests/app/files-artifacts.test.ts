import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { REPLAYED_HEADER } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

function upload(app: TestApp, cookie: string, name: string, content: Buffer | string, directory = '') {
  const data = typeof content === 'string' ? Buffer.from(content) : content;
  return call(app, 'POST', '/v2/files/upload', {
    cookie,
    body: { requestId: newRequestId('up'), directory, name, contentBase64: data.toString('base64') },
  });
}

test('文件页：没登录 401；上传 201、列出来、下载拿回同样的字节且不缓存、当附件', async () => {
  t = await startTestApp();
  assert.equal((await call(t, 'GET', '/v2/files')).status, 401);
  const cookie = await pair(t);
  const uploaded = await upload(t, cookie, '计划.md', '# 计划\n去西湖');
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const listing = json(await call(t, 'GET', '/v2/files', { cookie }));
  assert.deepEqual((listing['entries'] as Body[]).map((entry) => entry['name']), ['计划.md']);
  const download = await call(t, 'GET', `/v2/files/content?path=${encodeURIComponent('计划.md')}`, { cookie });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(download.body as ArrayBuffer).toString('utf8'), '# 计划\n去西湖');
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/);
});

test('文件页：路径出了根目录 400；不收的类型 415；内容和扩展名对不上 415；超大 413', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/files?path=..', { cookie })).status, 400);
  const outside = encodeURIComponent('../plasticine.sqlite');
  const escape = await call(t, 'GET', `/v2/files/content?path=${outside}`, { cookie });
  assert.equal(escape.status, 400);
  assert.equal((await upload(t, cookie, 'x.md', 'x', '../notes')).status, 400);
  assert.equal((await upload(t, cookie, 'run.sh', 'echo hi')).status, 415);
  assert.equal((await upload(t, cookie, '图.png', 'not a png')).status, 415);
  const huge = Buffer.alloc(20 * 1024 * 1024 + 1, 0x61);
  assert.equal((await upload(t, cookie, 'big.txt', huge)).status, 413);
  assert.equal(existsSync(join(t.directory, 'files', 'big.txt')), false);
});

test('改名、删除要打现在的名字；删除挪进回收能还原；重发同一个 requestId 不重做', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  await upload(t, cookie, 'a.txt', 'A');
  const wrong = await call(t, 'POST', '/v2/files/move', {
    cookie,
    body: { requestId: newRequestId('mv'), from: 'a.txt', to: 'b.txt', confirmName: 'b.txt' },
  });
  assert.equal(wrong.status, 400);
  assert.equal(json(wrong)['field'], 'confirmName');
  const trashBody = { requestId: newRequestId('tr'), path: 'a.txt', confirmName: 'a.txt' };
  const trashed = await call(t, 'POST', '/v2/files/trash', { cookie, body: trashBody });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  const again = await call(t, 'POST', '/v2/files/trash', { cookie, body: trashBody });
  assert.equal(again.headers.get(REPLAYED_HEADER), '1');
  const trash = json(await call(t, 'GET', '/v2/files/trash', { cookie }))['entries'] as Body[];
  assert.equal(trash.length, 1);
  const restored = await call(t, 'POST', '/v2/files/restore', {
    cookie,
    body: { requestId: newRequestId('rs'), id: String(trash[0]?.['id']) },
  });
  assert.equal(((json(restored)['entry'] as Body)['path']), 'a.txt');
});

test('笔记版本：每次保存留一版，能按版本读回原来的字', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const created = json(await call(t, 'POST', '/v2/notes', {
    cookie,
    body: { requestId: newRequestId('nt'), markdown: '# 第一版' },
  }));
  const id = String(created['id']);
  const save = { requestId: newRequestId('sv'), version: 1, markdown: '# 第二版' };
  await call(t, 'PUT', `/v2/notes/${id}`, { cookie, body: save });
  const versions = json(await call(t, 'GET', `/v2/notes/${id}/versions`, { cookie }))['versions'] as Body[];
  assert.deepEqual(versions.map((row) => row['version']), [2, 1]);
  const first = json(await call(t, 'GET', `/v2/notes/${id}/versions/1`, { cookie }));
  assert.equal(first['markdown'], '# 第一版');
  assert.equal((await call(t, 'GET', `/v2/notes/${id}/versions/9`, { cookie })).status, 404);
  assert.equal((await call(t, 'GET', `/v2/notes/${id}/versions/x`, { cookie })).status, 400);
});
