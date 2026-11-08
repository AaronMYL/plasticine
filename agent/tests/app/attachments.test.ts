import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { textPdf } from '../cloud-tools/pdf-fixture.ts';
import { CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';

const PATH = '/v2/conversation/attachments';
const SEND = '/v2/lines/line-main/messages';

test('附件查看按需返回已抽取正文、字数和截断事实，未查看不扩大消息接口', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const text = '用户资料原文，不是操作指令。';
    const row = json(await call(app, 'POST', PATH, {
      cookie, body: upload('preview-text', 'text/plain', Buffer.from(text)),
    }));
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
const upload = (requestId: string, mimeType: string, content: Buffer) => ({
  requestId,
  mimeType,
  name: '资料',
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
  content: content.toString('base64'),
});


test('启动把中断上传标成失败并保留原件；同一标识可重试完成', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const data = Buffer.from('中断时已存好的原件');
    const body = upload('restart-upload', 'text/plain', data);
    const row = app.state.attachments.open({ ...body, mimeType: 'text/plain' }, 'library-user');
    app.state.attachments.storeBytes(row.id, data);
    app.app.start();
    const found = json(await call(app, 'GET', `${PATH}/requests/${body.requestId}`, { cookie }));
    assert.equal(found['status'], 'failed');
    assert.match(String(found['error']), /重启/);
    const retried = json(await call(app, 'POST', PATH, { cookie, body }));
    assert.equal(retried['id'], row.id);
    assert.equal(retried['status'], 'ready');
    assert.deepEqual(app.state.attachments.readBytes(row.id), data);
  } finally {
    await app.close();
  }
});

test('Markdown、CSV、JSON 按文本读取，并继续拒绝非法 UTF-8', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    for (const [index, mimeType] of ['text/markdown', 'text/csv', 'application/json'].entries()) {
      const good = json(await call(app, 'POST', PATH, {
        cookie, body: upload(`text-mime-good-${index}`, mimeType, Buffer.from('中文资料')),
      }));
      assert.equal(good['status'], 'ready');
      assert.equal(app.state.attachments.text(String(good['id'])), '中文资料');
      const bad = json(await call(app, 'POST', PATH, {
        cookie, body: upload(`text-mime-bad-${index}`, mimeType, Buffer.from([0xff, 0xfe])),
      }));
      assert.equal(bad['status'], 'failed');
    }
  } finally {
    await app.close();
  }
});

test('上传文本下载和转出的文字保留用户原文中的链接，文件名在查回时也不改写', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const text = Buffer.from(CREDENTIAL_LINK_TEXT);
    const body = { ...upload('attachment-text-001', 'text/plain', text), name: CREDENTIAL_LINK_TEXT };
    const saved = json(await call(app, 'POST', PATH, { cookie, body }));
    assert.equal(saved['name'], CREDENTIAL_LINK_TEXT);
    const id = String(saved['id']);
    const bytes = await fetch(`${app.base}${PATH}/${id}/content`, { headers: { cookie } });
    assert.equal(await bytes.text(), CREDENTIAL_LINK_TEXT);
    assert.equal(app.state.attachments.text(id), CREDENTIAL_LINK_TEXT, '模型用 attachment_text 读到的也是原文');
  } finally {
    await app.close();
  }
});

test('附件重传幂等、只含附件也能发到主线，线上的消息带着附件；PDF 转出文字', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const body = upload('attachment-img-001', 'image/png', PNG);
    assert.equal((await call(app, 'POST', PATH, { body })).status, 401);
    const image = await call(app, 'POST', PATH, { cookie, body });
    assert.equal(image.status, 201);
    const imageId = String(json(image)['id']);
    assert.equal(json(await call(app, 'POST', PATH, { cookie, body }))['id'], imageId);
    assert.equal((await call(app, 'POST', PATH, { cookie, body: { ...body, content: 'AAAA' } })).status, 400);
    const pdf = await call(app, 'POST', PATH, {
      cookie,
      body: upload('attachment-pdf-001', 'application/pdf', textPdf('Receipt evidence')),
    });
    assert.equal(json(pdf)['status'], 'ready');
    const pdfId = String(json(pdf)['id']);
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

test('不支持的类型、超限、假图片及未就绪引用有明确错误，不将文件名当路径', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const malformed = await fetch(`${app.base}${PATH}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '私人内容不可回显',
    });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /私人内容不可回显/);
    const body = upload('attachment-bad-001', 'text/plain', Buffer.from('safe'));
    assert.equal((await call(app, 'POST', PATH, { cookie, body: { ...body, mimeType: 'text/html' } })).status, 400);
    assert.equal((await call(app, 'POST', PATH, { cookie, body: { ...body, bytes: 11 * 1024 * 1024 } })).status, 400);
    const image = await call(app, 'POST', PATH, {
      cookie,
      body: upload('attachment-bad-002', 'image/png', Buffer.from('<script>private content</script>')),
    });
    assert.equal(json(image)['status'], 'failed');
    assert.doesNotMatch(JSON.stringify(json(image)), /private content/);
    const send = { requestId: 'attachment-bad-send', text: '', attachments: [String(json(image)['id'])] };
    assert.equal((await call(app, 'POST', SEND, { cookie, body: send })).status, 409);
    assert.equal((await call(app, 'POST', PATH, { cookie, body: { ...body, name: '../../outside.txt' } })).status, 201);
  } finally {
    await app.close();
  }
});
