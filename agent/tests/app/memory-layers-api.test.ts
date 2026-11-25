import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { MEMORY_DOCS_PATH, MEMORY_GRANTS_PATH, MEMORY_LOOP_GRANT_REVOKE_PATH, MEMORY_TOPICS_PATH,
  MemoryGrantsResponseSchema, MemoryTopicDocSchema, MemoryTopicListResponseSchema, memoryLineMovePath,
  memoryLinesPath, type MemoryTopicDoc, type MemoryTopicListResponse } from '../../shared/api/index.ts';
import { GRANTS_DOC_ID, PROACTIVE_DOC_ID } from '../../shared/state.ts';
import { noteExperience } from '../../src/memory/docs/experience.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function topic(app: TestApp, cookie: string, id: string): Promise<MemoryTopicDoc> {
  const body = json(await call(app, 'GET', `${MEMORY_TOPICS_PATH}/${id}`, { cookie }));
  assert.ok(Value.Check(MemoryTopicDocSchema, body), JSON.stringify([...Value.Errors(MemoryTopicDocSchema, body)][0]));
  return body;
}

async function add(app: TestApp, cookie: string, docId: string, section: string, text: string): Promise<void> {
  const reply = await call(app, 'POST', memoryLinesPath(docId), { cookie,
    body: { requestId: `add-${section}-${text.length}-${text.charCodeAt(0)}`, text, section } });
  assert.equal(reply.status, 201, JSON.stringify(json(reply)));
}

test('memory index keeps two agreement pages first with counts; work experience group last', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  await add(t, cookie, GRANTS_DOC_ID, 'allow', '定时任务可以自己加，加完告诉你');
  await add(t, cookie, GRANTS_DOC_ID, 'ask', '改线上数据之前先问');
  noteExperience(t.state, { topic: '小红书', section: 'do', lineId: 'main', text: '链接要带着 xsec_token 才打得开' },
    { actor: 'brain', ref: 'line:main' });
  const body = json(await call(t, 'GET', MEMORY_TOPICS_PATH, { cookie })) as MemoryTopicListResponse;
  assert.ok(Value.Check(MemoryTopicListResponseSchema, body));
  const kinds = body.groups.map((group) => group.kind);
  assert.deepEqual([kinds[0], kinds[1], kinds.at(-1)], ['grants', 'about_you', 'how']);
  const agreed = body.groups[0]!.topics;
  assert.deepEqual(agreed.map((item) => item.title), ['承诺和授权', '主动告诉你']);
  assert.equal(agreed[0]!.summary, '可以直接做 1 · 先问你 1');
  assert.match(agreed[1]!.summary, /^每 30 分钟看 \d+ 件事 · 23:00–08:00 不打扰$/);
  assert.deepEqual(body.groups.at(-1)!.topics.map((item) => [item.kind, item.title, item.lineCount]),
    [['how', '小红书', 1]]);
});

test('memory page lists sections in order with dates; work experience marks tried-out and source line', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  await add(t, cookie, GRANTS_DOC_ID, 'promise', '读完一本书给你一页笔记');
  await add(t, cookie, GRANTS_DOC_ID, 'allow', '定时任务可以自己加，加完告诉你');
  const grants = await topic(t, cookie, GRANTS_DOC_ID);
  assert.deepEqual(grants.sections.map((section) => [section.section, section.heading]),
    [['allow', '可以直接做'], ['promise', '答应你的']]);
  assert.match(grants.sections[0]!.lines[0]!.at ?? '', /^\d{4}-\d\d-\d\dT/);
  const first = noteExperience(t.state, { topic: '小红书', section: 'avoid', lineId: 'main',
    text: '连着打开超过 50 篇会弹验证' }, { actor: 'brain', ref: 'line:main' });
  assert.ok(first.saved);
  noteExperience(t.state, { topic: '小红书', section: 'avoid', lineId: 'main', text: '连着打开超过 30 篇会弹验证',
    replacesLineId: first.line.id }, { actor: 'brain', ref: 'line:main' });
  const how = await topic(t, cookie, first.doc.id);
  assert.equal(how.topic.kind, 'how');
  const line = how.sections[0]!.lines[0]!;
  assert.equal(how.sections[0]!.heading, '要避开的');
  assert.equal(line.basis, 'tried');
  assert.equal(line.previous, '连着打开超过 50 篇会弹验证');
  assert.deepEqual(line.sources.map((source) => [source.kind, source.id]), [['work', 'main']]);
});

test('add line to section, move section (pause/resume), archive readable; rejects bad section', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  await add(t, cookie, GRANTS_DOC_ID, 'allow', '每周回顾可以自己发');
  const line = t.state.memoryDocs.lines.live(GRANTS_DOC_ID)[0]!;
  const wrong = await call(t, 'POST', memoryLinesPath(GRANTS_DOC_ID), { cookie,
    body: { requestId: 'add-wrong-section', text: '周末不提工作', section: 'never' } });
  assert.equal(wrong.status, 400);
  const same = await call(t, 'POST', memoryLineMovePath(GRANTS_DOC_ID, line.id), { cookie,
    body: { requestId: 'hold-same-1', version: line.version, toDocId: GRANTS_DOC_ID, section: 'allow' } });
  assert.equal(same.status, 400);
  const held = await call(t, 'POST', memoryLineMovePath(GRANTS_DOC_ID, line.id), { cookie,
    body: { requestId: 'hold-line-1', version: line.version, toDocId: GRANTS_DOC_ID, section: 'hold' } });
  assert.equal(held.status, 200, JSON.stringify(json(held)));
  const now = t.state.memoryDocs.lines.live(GRANTS_DOC_ID)[0]!;
  assert.equal(now.section, 'hold');
  const withdrawn = await call(t, 'POST', `${MEMORY_DOCS_PATH}/${GRANTS_DOC_ID}/lines/${now.id}/retire`, { cookie,
    body: { requestId: 'withdraw-1', version: now.version, mode: 'withdraw' } });
  assert.equal(withdrawn.status, 200);
  assert.equal(t.state.memoryDocs.lines.live(GRANTS_DOC_ID).length, 0);
  const kept = t.state.memoryDocs.lines.require(now.id);
  assert.equal(kept.retiredReason, 'no_longer_true');
  assert.notEqual(kept.archivedAt, null, '收回的进归档，不删');
  assert.equal(kept.deletedAt, null);
});

test('delegated permission categories are readable and disappear once revoked', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  t.state.loop.grants.grant('把信息流里的文章存进资料库', 'device-1', 'ask-1');
  const before = json(await call(t, 'GET', MEMORY_GRANTS_PATH, { cookie }));
  assert.ok(Value.Check(MemoryGrantsResponseSchema, before));
  assert.deepEqual(before.loop.map((grant) => grant.topic), ['把信息流里的文章存进资料库']);
  const topics = json(await call(t, 'GET', MEMORY_TOPICS_PATH, { cookie })) as MemoryTopicListResponse;
  assert.equal(topics.groups[0]!.topics[0]!.summary, '可以直接做 1', '放过手的算进可以直接做');
  const after = await call(t, 'POST', MEMORY_LOOP_GRANT_REVOKE_PATH, { cookie,
    body: { requestId: 'revoke-loop-1', topic: '把信息流里的文章存进资料库' } });
  assert.equal(after.status, 200);
  assert.deepEqual((json(after) as { loop: unknown[] }).loop, []);
  assert.equal(t.state.loop.grants.list().length, 0);
});

test('proactive-notice lines use same sections as commitments/grants; heartbeat updates quiet hours', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  await add(t, cookie, PROACTIVE_DOC_ID, 'style', '一句话说完，细节放链接里');
  await add(t, cookie, PROACTIVE_DOC_ID, 'never', '周末不提工作上的事');
  const page = await topic(t, cookie, PROACTIVE_DOC_ID);
  assert.deepEqual(page.sections.map((section) => section.heading), ['别提的', '怎么通知']);
  const changed = await call(t, 'PUT', '/v2/heartbeat', { cookie,
    body: { requestId: 'quiet-hours-1', quietFrom: '22:30', quietTo: '07:30' } });
  assert.equal(changed.status, 200, JSON.stringify(json(changed)));
  const view = json(changed) as { config: { quietFrom: string; quietTo: string } };
  assert.deepEqual([view.config.quietFrom, view.config.quietTo], ['22:30', '07:30']);
});
