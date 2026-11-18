import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const file = (name: string, text: string) => ({ name, contentBase64: Buffer.from(text, 'utf8').toString('base64') });

test('导入资料库：每个文件一个报告，没导入的带原因；同一请求重发不会多建；资料库列表里看得到', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const body = { requestId: 'req_import_spaces_1',
    files: [file('复盘.md', '# 季度复盘\n\n这一季做了不少事情。'), file('a.pdf', 'x')] };
  const reply = await call(t, 'POST', '/v2/spaces/import', { cookie, body });
  assert.equal(reply.status, 200);
  const result = json(reply);
  const imported = result['imported'] as { id: string; title: string; category: string; author: string }[];
  assert.deepEqual(imported.map((space) => [space.title, space.category, space.author]),
    [['季度复盘', 'report', 'user']]);
  assert.deepEqual(result['skipped'], [{ name: 'a.pdf', reason: '只收 Markdown、TXT、Word（.docx）和网页文件' }]);
  assert.deepEqual(json(await call(t, 'POST', '/v2/spaces/import', { cookie, body })), result);
  const list = json(await call(t, 'GET', '/v2/spaces', { cookie }))['spaces'] as { id: string }[];
  assert.deepEqual(list.map((space) => space.id), [imported[0]!.id]);
});

test('导出 Markdown、Word；删掉的、不存在的是 404；没登录 401', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const space = t.state.spaces.create({ title: '周报', doc: EMPTY_SPACE_DOC, genre: 'report', author: 'ai',
    html: '<h1>周报</h1><p>这周做完了三件事。</p>', category: 'report' });
  const md = await call(t, 'POST', '/v2/spaces/export', { cookie, body: { ids: [space.id], format: 'markdown' } });
  assert.equal(md.status, 200);
  assert.equal(Buffer.from(md.body as ArrayBuffer).toString('utf8'), '# 周报\n\n这周做完了三件事。\n');
  assert.equal(md.headers.get('content-disposition'), `attachment; filename*=UTF-8''${encodeURIComponent('周报.md')}`);
  const docx = await call(t, 'POST', '/v2/spaces/export', { cookie, body: { ids: [space.id], format: 'docx' } });
  assert.equal(docx.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal((await call(t, 'POST', '/v2/spaces/export', { cookie,
    body: { ids: ['missing'], format: 'markdown' } })).status, 404);
  t.state.spaces.markDeleted(space.id, space.version);
  assert.equal((await call(t, 'POST', '/v2/spaces/export', { cookie,
    body: { ids: [space.id], format: 'markdown' } })).status, 404);
  assert.equal((await call(t, 'POST', '/v2/spaces/export', { body: { ids: [space.id], format: 'docx' } })).status, 401);
});

test('出 PDF、长图：页面加上不许连网的规矩交给浏览器，回来的字节带文件名', async () => {
  const seen: { html: string; format: string }[] = [];
  t = await startTestApp([], { startTasks: false, renderPage: async (html, format) => {
    seen.push({ html, format });
    return Buffer.from(format === 'pdf' ? '%PDF' : 'png');
  } });
  const cookie = await pair(t);
  const pdf = await call(t, 'POST', '/v2/render', { cookie,
    body: { html: '<!doctype html><html><head><title>x</title></head><body>页面</body></html>', format: 'pdf',
      name: '周报' } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('content-disposition'), `attachment; filename*=UTF-8''${encodeURIComponent('周报.pdf')}`);
  assert.match(seen[0]?.html ?? '',
    /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  const png = await call(t, 'POST', '/v2/render', { cookie, body: { html: '<p>片段</p>', format: 'png', name: '图' } });
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.match(seen[1]?.html ?? '', /^<meta http-equiv="Content-Security-Policy"/);
  assert.equal((await call(t, 'POST', '/v2/render', { body: { html: '<p>x</p>', format: 'png', name: '图' } })).status,
    401);
});
