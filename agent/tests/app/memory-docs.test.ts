import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { afterEach, test } from 'node:test';
import { YOU_DOC_ID, type MemoryInference, type MemoryLine } from '../../shared/state.ts';
import { addLine, proposeInference } from '../../src/brain/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, signedCall, type TestDeviceKey } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(): Promise<{ t: TestApp; cookie: string; key: TestDeviceKey }> {
  t = await startTestApp();
  const cookie = await pair(t);
  const key = newDeviceKey();
  t.clock.advance(20 * 60_000);
  return { t, cookie, key };
}

/** 他在主线上说的一句，按 line:<线>:<seq> 认。 */
function said(app: TestApp, content: string): string {
  const lineId = app.state.lines.main().id;
  return `line:${lineId}:${app.state.lineMessages.append(lineId, 'user', { role: 'user', content, timestamp: 0 }).seq}`;
}

function line(app: TestApp, text: string, messageId: string): MemoryLine {
  const anchors = [{ kind: 'message' as const, ref: messageId }];
  return addLine(app.state, { docId: YOU_DOC_ID, text, basis: 'stated', anchors }, { actor: 'brain', ref: 'job-1' });
}

function inference(app: TestApp, text: string, messageId: string): MemoryInference {
  return proposeInference(app.state, { docId: YOU_DOC_ID, text, why: '三次都在深夜发消息',
    anchors: [{ kind: 'message', ref: messageId }], jobId: null }, { actor: 'brain', ref: 'job-1' });
}

test('目录：启动时补齐关于你和项目文档；带行数、字数、拿不准的条数、迁移和整理状态', async () => {
  const { t: app, cookie } = await start();
  const message = said(app, '我住在杭州');
  line(app, '住在杭州', message);
  inference(app, '作息偏晚', message);
  const reply = await call(app, 'GET', '/v2/memory/docs', { cookie });
  assert.equal(reply.status, 200);
  const body = json(reply);
  const docs = body['docs'] as Record<string, unknown>[];
  assert.equal(docs[0]?.['id'], YOU_DOC_ID);
  assert.equal(docs[0]?.['lines'], 1);
  assert.equal(docs[0]?.['chars'], 4);
  assert.equal(docs[0]?.['pendingInferences'], 1);
  assert.ok(docs.some((doc) => doc['kind'] === 'project'), '常驻项目的文档也在');
  assert.equal(body['pendingInferences'], 1);
  assert.deepEqual(body['migration'], { status: 'not_started', total: 0, pending: 0 });
  assert.deepEqual(body['curation'], { queued: 0, running: 0, failed: 0, lastError: null });
  assert.equal((body['metrics'] as Record<string, unknown>)['restated'], 0);
});

test('读一份文档：行带原话摘录和会话，要时带上退休的；没有的文档 404', async () => {
  const { t: app, cookie } = await start();
  const message = said(app, '我住在杭州，最近在学吉他');
  const home = line(app, '住在杭州', message);
  app.state.memoryDocs.lines.retire(home.id, home.version, 'revised');
  line(app, '在学吉他', message);
  const reply = await call(app, 'GET', `/v2/memory/docs/${YOU_DOC_ID}?includeRetired=true`, { cookie });
  const body = json(reply);
  const lines = body['lines'] as Record<string, unknown>[];
  assert.deepEqual(lines.map((row) => row['text']), ['在学吉他']);
  const anchors = lines[0]?.['anchors'] as Record<string, unknown>[];
  assert.deepEqual([anchors[0]?.['excerpt'], anchors[0]?.['chatId']], ['我住在杭州，最近在学吉他', 'line-main']);
  assert.deepEqual((body['retired'] as Record<string, unknown>[]).map((row) => row['retiredReason']), ['revised']);
  assert.equal((await call(app, 'GET', '/v2/memory/docs/memdoc-404', { cookie })).status, 404);
});

test('本人会话确认推断后写成文档里的一行并链回原话；没登录不写，定过再来 409', async () => {
  const { t: app, cookie, key } = await start();
  const message = said(app, '又是半夜两点');
  const guess = inference(app, '作息偏晚', message);
  const path = `/v2/memory/inferences/${guess.id}/confirm`;
  const unsigned = await call(app, 'POST', path, { body: { requestId: newRequestId(), version: 1 } });
  assert.equal(unsigned.status, 401);
  assert.equal(app.state.memoryCuration.inferences.require(guess.id).status, 'pending');
  const confirmed = await call(app, 'POST', path, { cookie, body: { requestId: newRequestId(), version: 1 } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const body = json(confirmed);
  const written = body['line'] as Record<string, unknown>;
  assert.equal(written['basis'], 'confirmed_inference');
  assert.equal((written['anchors'] as Record<string, unknown>[])[0]?.['ref'], message);
  assert.equal((body['inference'] as Record<string, unknown>)['status'], 'confirmed');
  const stored = app.state.memoryCuration.inferences.require(guess.id);
  assert.notEqual(stored.confirmedByDeviceId, null);
  assert.equal(stored.lineId, written['id']);
  const again = await signedCall(app, 'POST', path, { requestId: newRequestId(), version: stored.version },
    { cookie, key });
  assert.equal(again.status, 409);
  assert.equal(json(again)['code'], 'conflict');
});

test('否掉推断：本人会话记下决定、不成行；拿不准的列表只剩没定的', async () => {
  const { t: app, cookie, key } = await start();
  const message = said(app, '周末想去爬山');
  const kept = inference(app, '喜欢户外', message);
  const dropped = inference(app, '每周末都去爬山', message);
  const reply = await signedCall(app, 'POST', `/v2/memory/inferences/${dropped.id}/reject`,
    { requestId: newRequestId(), version: 1, reason: '只是这周想去' }, { cookie, key });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(json(reply)['line'], null);
  assert.equal(app.state.memoryDocs.lines.live(YOU_DOC_ID).length, 0);
  const pending = json(await call(app, 'GET', '/v2/memory/inferences', { cookie }));
  assert.deepEqual((pending['inferences'] as Record<string, unknown>[]).map((row) => row['id']), [kept.id]);
  const rejected = json(await call(app, 'GET', '/v2/memory/inferences?status=rejected', { cookie }));
  assert.deepEqual((rejected['inferences'] as Record<string, unknown>[]).map((row) => row['why']),
    ['三次都在深夜发消息']);
  assert.equal((await call(app, 'GET', '/v2/memory/inferences?status=maybe', { cookie })).status, 400);
});

test('记忆页回答拿不准的推断不需要钥匙，同一回答重发只形成一行', async () => {
  const { t: app, cookie } = await start();
  const guess = inference(app, '喜欢爬山', said(app, '周末去爬山'));
  const path = `/v2/memory/uncertain/${guess.id}`;
  const body = { requestId: newRequestId(), answer: 'yes', correction: null };
  const first = await call(app, 'POST', path, { cookie, body });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await call(app, 'POST', path, { cookie, body });
  assert.deepEqual(again.body, first.body);
  assert.equal(app.state.memoryDocs.lines.live(YOU_DOC_ID).length, 1);
  assert.equal(app.state.memoryCuration.inferences.require(guess.id).confirmedByDeviceId,
    app.state.devices.list()[0]!.id);
});

test('用户改一行：新行替代旧行、留之前、锚点加上这次改动；过时版本 409；退休的不再收改动', async () => {
  const { t: app, cookie } = await start();
  const message = said(app, '我住在杭州');
  const home = line(app, '住在杭州', message);
  const path = `/v2/memory/docs/${YOU_DOC_ID}/lines/${home.id}`;
  const requestId = newRequestId();
  const edited = await call(app, 'PUT', path, { cookie, body: { requestId, version: 1, text: '住在杭州西湖区' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const written = json(edited)['line'] as Record<string, unknown>;
  assert.equal(written['previous'], '住在杭州');
  assert.equal(written['writtenBy'], 'user');
  assert.deepEqual((written['anchors'] as Record<string, unknown>[]).map((anchor) => anchor['kind']),
    ['message', 'user_edit']);
  const replay = await call(app, 'PUT', path, { cookie, body: { requestId, version: 1, text: '住在杭州西湖区' } });
  assert.equal((json(replay)['line'] as Record<string, unknown>)['id'], written['id']);
  const late = await call(app, 'PUT', path, { cookie, body: { requestId: newRequestId(), version: 1, text: '别的' } });
  assert.equal(late.status, 409);
  assert.equal(json(late)['code'], 'conflict');
  const fresh = `/v2/memory/docs/${YOU_DOC_ID}/lines/${String(written['id'])}`;
  const stale = await call(app, 'PUT', fresh, { cookie, body: { requestId: newRequestId(), version: 9, text: '别的' } });
  assert.equal(json(stale)['code'], 'version_conflict');
  const wrongDoc = await call(app, 'PUT', `/v2/memory/docs/memdoc-404/lines/${String(written['id'])}`,
    { cookie, body: { requestId: newRequestId(), version: 1, text: '别的' } });
  assert.equal(wrongDoc.status, 404);
});

test('用户退休一行：整行退休（软删，行还在），文档里不再有它', async () => {
  const { t: app, cookie } = await start();
  const pet = line(app, '养了一只猫', said(app, '我养了一只猫'));
  const reply = await call(app, 'POST', `/v2/memory/docs/${YOU_DOC_ID}/lines/${pet.id}/retire`,
    { cookie, body: { requestId: newRequestId(), version: 1 } });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal((json(reply)['line'] as Record<string, unknown>)['retiredReason'], 'forgotten');
  assert.equal(app.state.memoryDocs.lines.live(YOU_DOC_ID).length, 0);
  assert.equal(app.state.memoryDocs.lines.require(pet.id).text, '养了一只猫');
  const bad = await call(app, 'POST', `/v2/memory/docs/${YOU_DOC_ID}/lines/${pet.id}/retire`,
    { cookie, body: { requestId: newRequestId() } });
  assert.equal(bad.status, 400);
});

test('主线一轮正常结束后入队一次整理，整理落库，回复和对话不受影响', async () => {
  const curation = JSON.stringify({ ops: [], used: [] });
  t = await startTestApp([curation], { memoryCuration: true });
  const cookie = await pair(t);
  t.respond([fauxAssistantMessage('你好，我记下了。')]);
  const body = { requestId: newRequestId(), text: '我住在杭州' };
  const sent = await call(t, 'POST', '/v2/lines/line-main/messages', { cookie, body });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const deadline = Date.now() + 5_000;
  let done = false;
  while (!done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    done = t.state.memoryCuration.jobs.withStatus('done').some((job) => job.kind === 'turn');
  }
  assert.equal(done, true, '对话轮之后的整理做完了');
  const [job] = t.state.memoryCuration.jobs.withStatus('done');
  assert.equal(job?.sourceIds.length, 1);
  assert.equal(t.state.lineMessages.said(job?.sourceIds[0] ?? '')?.text, '我住在杭州');
});
