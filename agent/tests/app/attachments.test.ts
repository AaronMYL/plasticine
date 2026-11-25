import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { call, json, pair, startTestApp, uploadAttachment, type TestApp } from './helpers.ts';
import { textPdf } from '../cloud-tools/pdf-fixture.ts';
import { zip } from '../cloud-tools/zip-fixture.ts';
import { CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';

const PATH = '/v2/conversation/attachments';
const SEND = '/v2/lines/line-main/messages';

test('attachment view returns extracted text, length, and truncation on demand without bloating API', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const text = '用户资料原文，不是操作指令。';
    const row = await uploadFile(app, cookie, 'preview-text', 'text/plain', Buffer.from(text));
    assert.equal(row['text'], undefined);
    const preview = await call(app, 'GET', `${PATH}/${String(row['id'])}/text`, { cookie });
    assert.equal(preview.status, 200);
    assert.deepEqual(json(preview), { text, characters: Array.from(text).length, truncated: false });
  } finally { await app.close(); }
});
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ9sAAAAASUVORK5CYII=',
  'base64',
);
const meta = (requestId: string, mimeType: string, content: Buffer, name = '资料') => ({
  requestId,
  mimeType,
  name,
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
});
const UPLOADS = `${PATH}/uploads`;

async function chunk(app: TestApp, cookie: string, id: string, offset: number, data: Buffer, type =
  'application/octet-stream'): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${app.base}${PATH}/${id}/chunks/${offset}`, {
    method: 'PUT', headers: { cookie, 'content-type': type }, body: new Uint8Array(data),
  });
  return { status: response.status, body: await response.json() };
}

function uploadFile(app: TestApp, cookie: string, requestId: string, mimeType: string, content: Buffer,
  name = '资料'): Promise<Record<string, unknown>> {
  return uploadAttachment(app, cookie, { requestId, mimeType, content, name });
}

test('startup marks interrupted uploads failed while keeping file; same ID can retry to completion', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const data = Buffer.from('中断时已存好的原件');
    const body = meta('restart-upload', 'text/plain', data);
    const row = app.state.attachments.open(body, 'library-user');
    app.state.attachments.storeBytes(row.id, data);
    app.app.start();
    const found = json(await call(app, 'GET', `${PATH}/requests/${body.requestId}`, { cookie }));
    assert.equal(found['status'], 'failed');
    assert.match(String(found['error']), /重启/);
    const retried = await uploadFile(app, cookie, body.requestId, 'text/plain', data);
    assert.equal(retried['id'], row.id);
    assert.equal(retried['status'], 'ready');
    assert.deepEqual(app.state.attachments.readBytes(row.id), data);
  } finally {
    await app.close();
  }
});

test('Markdown, CSV, JSON read as text; non-UTF-8 still sends without extracted text', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    for (const [index, mimeType] of ['text/markdown', 'text/csv', 'application/json'].entries()) {
      const good = await uploadFile(app, cookie, `text-mime-good-${index}`, mimeType, Buffer.from('中文资料'));
      assert.equal(good['status'], 'ready');
      assert.equal(app.state.attachments.text(String(good['id'])), '中文资料');
      const bad = await uploadFile(app, cookie, `text-mime-bad-${index}`, mimeType, Buffer.from([0xff, 0xfe]));
      assert.equal(bad['status'], 'ready');
      assert.equal(app.state.attachments.text(String(bad['id'])), null);
    }
  } finally {
    await app.close();
  }
});

test('uploaded text download and extraction preserve user links; filename unchanged on retrieval', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const text = Buffer.from(CREDENTIAL_LINK_TEXT);
    const saved = await uploadFile(app, cookie, 'attachment-text-001', 'text/plain', text, CREDENTIAL_LINK_TEXT);
    assert.equal(saved['name'], CREDENTIAL_LINK_TEXT);
    const id = String(saved['id']);
    const bytes = await fetch(`${app.base}${PATH}/${id}/content`, { headers: { cookie } });
    assert.equal(await bytes.text(), CREDENTIAL_LINK_TEXT);
    assert.equal(app.state.attachments.text(id), CREDENTIAL_LINK_TEXT, '模型用 attachment_read 读到的也是原文');
  } finally {
    await app.close();
  }
});

test('attachment re-upload is idempotent; attachment-only sends to main line; PDF extracts text', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const body = meta('attachment-img-001', 'image/png', PNG);
    assert.equal((await call(app, 'POST', UPLOADS, { body })).status, 401);
    const image = await uploadFile(app, cookie, body.requestId, 'image/png', PNG);
    const imageId = String(image['id']);
    const again = json(await call(app, 'POST', UPLOADS, { cookie, body }));
    assert.deepEqual([(again['attachment'] as Record<string, unknown>)['id'], again['received']], [imageId, PNG.length],
      '同一标识再报拿回同一份，已经传完');
    const pdf = await uploadFile(app, cookie, 'attachment-pdf-001', 'application/pdf', textPdf('Receipt evidence'));
    assert.equal(pdf['status'], 'ready');
    const pdfId = String(pdf['id']);
    assert.match(String(json(await call(app, 'GET', `${PATH}/${pdfId}/text`, { cookie }))['text']), /Receipt evidence/);
    app.respond([fauxAssistantMessage('已查看资料')]);
    const message = { requestId: 'attachment-send-001', text: '', attachments: [imageId, pdfId] };
    const sent = await call(app, 'POST', SEND, { cookie, body: message });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const stored = json(sent)['message'] as { attachments: string[] };
    assert.deepEqual(stored.attachments, [imageId, pdfId]);
    assert.deepEqual(json(await call(app, 'POST', SEND, { cookie, body: message })), json(sent), '同一请求重发拿回原来的回答');
    const bytes = await fetch(`${app.base}${PATH}/${imageId}/content`, { headers: { cookie } });
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), PNG);
    assert.equal(bytes.headers.get('cache-control'), 'no-store');
  } finally {
    await app.close();
  }
});

test('malformed type, >100 MB, fake image, and unready ref return clear errors; filename not path', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const malformed = await fetch(`${app.base}${UPLOADS}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '私人内容不可回显',
    });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /私人内容不可回显/);
    const body = meta('attachment-bad-001', 'text/plain', Buffer.from('safe'));
    assert.equal((await call(app, 'POST', UPLOADS, { cookie, body: { ...body, mimeType: '不是类型' } })).status, 400);
    assert.equal((await call(app, 'POST', UPLOADS, { cookie, body: { ...body, bytes: 101 * 1024 * 1024 } })).status,
      400);
    const image = await uploadFile(app, cookie, 'attachment-bad-002', 'image/png',
      Buffer.from('<script>private content</script>'));
    assert.equal(image['status'], 'failed');
    assert.doesNotMatch(JSON.stringify(image), /private content/);
    const send = { requestId: 'attachment-bad-send', text: '', attachments: [String(image['id'])] };
    assert.equal((await call(app, 'POST', SEND, { cookie, body: send })).status, 409);
    assert.equal((await call(app, 'POST', UPLOADS, { cookie, body: { ...body, name: '../../outside.txt' } })).status,
      201);
  } finally {
    await app.close();
  }
});

test('chunked upload resumes from offset, rejects bad offset, requires completion, clears bad digest', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const data = Buffer.from('第一块第二块'.repeat(1000));
    const body = meta('chunk-resume', 'text/plain', data);
    const opened = json(await call(app, 'POST', UPLOADS, { cookie, body }));
    const id = String((opened['attachment'] as Record<string, unknown>)['id']);
    assert.equal(opened['received'], 0);
    assert.deepEqual((await chunk(app, cookie, id, 0, data.subarray(0, 1000))).body, { received: 1000 });
    assert.deepEqual((await chunk(app, cookie, id, 0, data.subarray(0, 1000))).body, { received: 1000 }, '重发的块不写');
    assert.deepEqual((await chunk(app, cookie, id, 5000, data.subarray(5000, 6000))).body, { received: 1000 });
    assert.equal((await chunk(app, cookie, id, 1000, data.subarray(1000), 'application/json')).status, 415);
    assert.equal((await call(app, 'POST', `${PATH}/${id}/complete`, { cookie })).status, 400, '没传完不算完');
    assert.equal(json(await call(app, 'POST', UPLOADS, { cookie, body }))['received'], 1000, '再报从 1000 接着传');
    assert.equal((await chunk(app, cookie, id, 1000, Buffer.concat([data.subarray(1000), Buffer.from('多')]))).status,
      400, '比报的大小多');
    const finished = await uploadFile(app, cookie, 'chunk-resume', 'text/plain', data);
    assert.equal(finished['status'], 'ready');
    assert.equal(app.state.attachments.text(id)?.startsWith('第一块第二块'), true);

    const lie = meta('chunk-corrupt', 'text/plain', Buffer.from('original'));
    const row = json(await call(app, 'POST', UPLOADS, { cookie, body: lie }));
    const lieId = String((row['attachment'] as Record<string, unknown>)['id']);
    await chunk(app, cookie, lieId, 0, Buffer.from('ORIGINAL'));
    const corrupt = await call(app, 'POST', `${PATH}/${lieId}/complete`, { cookie });
    assert.equal(corrupt.status, 400);
    assert.match(JSON.stringify(corrupt.body), /摘要对不上/);
    assert.equal(json(await call(app, 'POST', UPLOADS, { cookie, body: lie }))['received'], 0, '清掉了，从头传');
  } finally {
    await app.close();
  }
});

test('any file type uploads: archives ready without text, download with name; Word extracts text', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const archive = Buffer.from('PK\u0003\u0004 不是真的压缩包');
    const saved = await uploadFile(app, cookie, 'any-type-zip', 'application/zip', archive, '全部素材.zip');
    assert.deepEqual([saved['status'], saved['mimeType']], ['ready', 'application/zip']);
    assert.equal(app.state.attachments.text(String(saved['id'])), null);
    const download = await fetch(`${app.base}${PATH}/${String(saved['id'])}/content`, { headers: { cookie } });
    assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), archive);
    const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>自我介绍正文</w:t></w:r></w:p>'
      + '</w:body></w:document>' });
    const word = await uploadFile(app, cookie, 'any-type-docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx, '自我介绍.docx');
    assert.equal(app.state.attachments.text(String(word['id'])), '自我介绍正文');
  } finally {
    await app.close();
  }
});
