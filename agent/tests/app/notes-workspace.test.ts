import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { NOTE_IMAGE_MAX_BYTES, NoteAssistStreamEventSchema, type NoteAssistStreamEvent }
  from '../../shared/api/index.ts';
import { TextModelError } from '../../src/kernel/index.ts';
import type { TextStep } from '../brain/helpers.ts';
import { call, json, pair, startTestApp, type ApiReply, type TestApp } from './helpers.ts';

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

test('预测闭环：续写回一个 id，他收下后报回来只记一次，报错的一处不认', async () => {
  const current = note();
  const view = await json(await call(t, 'POST', `/v2/notes/${current.id}/assist`, {
    cookie, body: { action: 'predict', markdown: '# 原文\n正文' },
  }));
  const loopId = String(view['loopId']);
  const report = (area: string, outcome: string) => call(t, 'POST', `/v2/notes/${current.id}/assist/outcome`,
    { cookie, body: { area, loopId, outcome } });
  assert.deepEqual(await json(await report('note_supplement', 'kept')), { resolved: false });
  assert.deepEqual(await json(await report('note_predict', 'kept')), { resolved: true });
  assert.deepEqual(await json(await report('note_predict', 'rejected')), { resolved: false });
  assert.equal(t.state.loop.tallies('note_predict')[0]?.kept, 1);
  assert.equal((await report('note_predict', 'maybe')).status, 400);
});

/** SSE 回答拆成一条条事件，每条都要合 shared 里的 schema。 */
function events(reply: ApiReply): NoteAssistStreamEvent[] {
  const text = Buffer.from(reply.body as ArrayBuffer).toString();
  return text.split('\n\n').filter((frame) => frame.trim() !== '').map((frame) => {
    assert.ok(frame.startsWith('data: '), frame);
    const value: unknown = JSON.parse(frame.slice('data: '.length));
    assert.ok(Value.Check(NoteAssistStreamEventSchema, value), frame);
    return value;
  });
}

async function streamingApp(step: TextStep): Promise<{ app: TestApp; cookie: string }> {
  const app = await startTestApp([step]);
  return { app, cookie: await pair(app) };
}

test('续写要流式：回 SSE，增量拼起来是最终文字的开头，最后一条 done 以它为准', async () => {
  const current = note('正在记录这段经历');
  const response = await call(t, 'POST', `/v2/notes/${current.id}/assist`, {
    cookie, body: { action: 'predict', markdown: '正在记录这段经历', before: '正在记录这段经历', after: '',
      stream: true },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const received = events(response);
  const done = received.at(-1);
  assert.equal(done?.type, 'done');
  assert.equal(done?.type === 'done' ? done.view.markdown : null, '接下来的一句');
  const text = received.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');
  assert.equal(text, '接下来的一句');
  assert.ok(received.length > 2, '一段段送');
});

test('流式续写开始送之前失败：照旧是普通的错误回答；送了一半才失败：最后一条是 error', async (context) => {
  const early = await streamingApp(new TextModelError('busy', '连不上模型'));
  context.after(() => early.app.close());
  const target = early.app.state.notes.create({ markdown: '前文', folder: '笔记', author: 'user' });
  const failed = await call(early.app, 'POST', `/v2/notes/${target.id}/assist`, {
    cookie: early.cookie, body: { action: 'predict', markdown: '前文', stream: true } });
  assert.equal(failed.status, 500);
  assert.equal(typeof json(failed)['error'], 'string');
  const late = await streamingApp(async (_request, _signal, onText) => {
    onText?.('，先写');
    throw new TextModelError('busy', '连不上模型');
  });
  context.after(() => late.app.close());
  const other = late.app.state.notes.create({ markdown: '前文', folder: '笔记', author: 'user' });
  const broken = await call(late.app, 'POST', `/v2/notes/${other.id}/assist`, {
    cookie: late.cookie, body: { action: 'predict', markdown: '前文', stream: true } });
  assert.equal(broken.status, 200);
  const received = events(broken);
  assert.deepEqual(received.slice(0, 1), [{ type: 'text', delta: '，先写' }]);
  assert.equal(received.at(-1)?.type, 'error');
});
