// 记忆页的新读法（《优化清单》第 16、19、10 条，11-06 定）：目录按 关于你和做事方式 · 项目 · 人 · 话题 · 技能 分组、
// 档位（非私密才标）、超上限标记、昨晚整理的入口（没有就不出现）；文档里 [[双链]] 指向哪一篇；搜索默认现行、可带归档；
// 「昨晚整理了什么」读、撤销、拿不准的挑一个。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { RULES_DOC_ID, YOU_DOC_ID, type MemoryLine } from '../../shared/state.ts';
import { addLine, reviseLine } from '../../src/brain/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(): Promise<{ app: TestApp; cookie: string }> {
  t = await startTestApp();
  const cookie = await pair(t);
  return { app: t, cookie };
}

const writer = { actor: 'brain' as const, ref: 'job-1' };

function said(app: TestApp, content: string): string {
  const lineId = app.state.lines.main().id;
  return `line:${lineId}:${app.state.lineMessages.append(lineId, 'user', { role: 'user', content, timestamp: 0 }).seq}`;
}

function line(app: TestApp, docId: string, text: string, ref: string): MemoryLine {
  return addLine(app.state, { docId, text, basis: 'stated', anchors: [{ kind: 'message', ref }] }, writer);
}

type Row = Record<string, unknown>;

test('目录：按类型分组（你在前、项目、人物、其他：话题和技能并在一起），档位默认私密、定过的照定的；超上限标出来；没有整理不给入口',
  async () => {
    const { app, cookie } = await start();
    const ref = said(app, '小林是我大学同学');
    const person = app.state.memoryDocs.docs.create({ kind: 'person', title: '小林', summary: '大学同学；聊到他时读',
      charLimit: 200, createdBy: 'brain' });
    line(app, person.id, '大学同学，在做独立游戏', ref);
    line(app, person.id, '长'.repeat(199), ref);
    const skill = app.state.memoryDocs.docs.create({ kind: 'skill', title: '视频解析', summary: '先用自带字幕',
      createdBy: 'brain' });
    app.state.visibilityMarks.put('memory_topic', person.id, 0, { tier: 'friend', proposed: null, confirmed: true });
    app.state.visibilityMarks.put('memory_topic', skill.id, 0, { proposed: 'public', confirmed: false });
    const body = json(await call(app, 'GET', '/v2/memory/topics', { cookie }));
    const groups = body['groups'] as { kind: string; topics: Row[] }[];
    assert.deepEqual(groups.map((group) => group.kind), ['about_you', 'project', 'person', 'topic']);
    const topics = groups.flatMap((group) => group.topics);
    const find = (id: string) => topics.find((topic) => topic['id'] === id);
    assert.equal(find(person.id)?.['tier'], 'friend');
    assert.equal(find(person.id)?.['overLimit'], true);
    assert.deepEqual(find(person.id)?.['material'], { kind: 'memory_topic', id: person.id, version: 1 });
    assert.equal(find(skill.id)?.['tier'], 'private', '只有建议、没确认的照旧私密');
    assert.equal(find(YOU_DOC_ID)?.['tier'], 'private');
    const project = groups.find((group) => group.kind === 'project')?.topics[0];
    assert.equal((project?.['material'] as Row)['kind'], 'project', '项目档案的档位跟着项目');
    assert.equal(body['dream'], null);
  });

test('文档里的 [[名字]] 指向那一篇；对不上的给 null；出处写「主线 · 几月几日」', async () => {
  const { app, cookie } = await start();
  const ref = said(app, '小林在帮我做 Cyber Hunter 的网站');
  const person = app.state.memoryDocs.docs.create({ kind: 'person', title: '小林', summary: '大学同学',
    createdBy: 'brain' });
  line(app, YOU_DOC_ID, '[[小林]] 在帮忙做 [[没有这篇]] 的网站', ref);
  const doc = json(await call(app, 'GET', `/v2/memory/topics/${YOU_DOC_ID}`, { cookie }));
  const first = ((doc['sections'] as Row[])[0]?.['lines'] as Row[])[0];
  assert.deepEqual(first?.['links'], [{ name: '小林', topicId: person.id }, { name: '没有这篇', topicId: null }]);
  assert.match(((first?.['sources'] as Row[])[0]?.['label'] as string), /^主线 · \d+月\d+日$/);
});

test('搜记忆：默认只搜现行；带 archive 连归档，归档的标出归档时间', async () => {
  const { app, cookie } = await start();
  const ref = said(app, '通知只发消息');
  const old = line(app, RULES_DOC_ID, '重要的事再发一封邮件兜底', ref);
  reviseLine(app.state, old, '通知只发消息，不发邮件', [{ kind: 'message', ref }], writer);
  const current = json(await call(app, 'GET', '/v2/memory/search?q=%E9%82%AE%E4%BB%B6', { cookie }));
  assert.deepEqual((current['hits'] as Row[]).map((hit) => [hit['text'], hit['archivedAt'] === null]),
    [['通知只发消息，不发邮件', true]]);
  const all = json(await call(app, 'GET', '/v2/memory/search?q=%E9%82%AE%E4%BB%B6&archive=true', { cookie }));
  assert.deepEqual((all['hits'] as Row[]).map((hit) => hit['archivedAt'] === null).sort(), [false, true]);
  assert.equal((await call(app, 'GET', '/v2/memory/search?q=', { cookie })).status, 400);
});

test('昨晚整理了什么：读最近一次；撤销新加删掉那一行，撤销替换放回旧说法；拿不准的挑一个写进文档；重放不重做',
  async () => {
    const { app, cookie } = await start();
    const ref = said(app, '研究周报偏基础研究');
    const state = app.state;
    assert.equal((await call(app, 'GET', '/v2/memory/dreams/latest', { cookie })).status, 404);
    const added = line(app, YOU_DOC_ID, '研究周报偏基础研究', ref);
    const old = line(app, RULES_DOC_ID, '重要的事再发邮件兜底', ref);
    const replaced = reviseLine(state, old, '通知只发消息', [{ kind: 'message', ref }], writer);
    const dream = state.memoryDreams.create({ startedAt: '2026-11-06T17:00:00.000Z', linesRead: 6,
      conversationsRead: 43 });
    const anchors = [{ kind: 'message' as const, ref }];
    state.memoryDreams.addChange({ dreamId: dream.id, kind: 'add', docId: YOU_DOC_ID, lineId: added.id,
      text: added.text, anchors });
    state.memoryDreams.addChange({ dreamId: dream.id, kind: 'replace', docId: RULES_DOC_ID, lineId: replaced.id,
      oldLineId: old.id, text: replaced.text, previous: old.text, anchors });
    state.memoryDreams.addChange({ dreamId: dream.id, kind: 'unsure', docId: RULES_DOC_ID, text: '悬赏先挂哪里',
      anchors: [], candidates: [{ text: '悬赏先挂 GitHub Issues', anchors }, { text: '悬赏先挂网站', anchors }] });
    state.memoryDreams.addChange({ dreamId: dream.id, kind: 'dead_end', text: '抖音的下载地址在腾讯云上用不了',
      anchors });
    state.memoryDreams.finish(dream.id, dream.version);

    const list = json(await call(app, 'GET', '/v2/memory/topics', { cookie }));
    assert.deepEqual(list['dream'], { id: dream.id, finishedAt: state.memoryDreams.latest()?.finishedAt, total: 4,
      add: 1, replace: 1, unsure: 1, deadEnd: 1 });
    const view = json(await call(app, 'GET', '/v2/memory/dreams/latest', { cookie }));
    const changes = view['changes'] as Row[];
    assert.deepEqual(changes.map((change) => [change['kind'], change['canUndo']]),
      [['add', true], ['replace', true], ['unsure', false], ['dead_end', false]]);
    assert.equal(view['conversationsRead'], 43);

    const undo = (change: Row, requestId = newRequestId()) => call(app, 'POST',
      `/v2/memory/dreams/changes/${String(change['id'])}/undo`, { cookie, body: { requestId,
        version: change['version'] } });
    const requestId = newRequestId();
    const undoneAdd = await undo(changes[0] ?? {}, requestId);
    assert.equal(undoneAdd.status, 200);
    assert.equal(json(undoneAdd)['undone'], true);
    assert.equal((await undo(changes[0] ?? {}, requestId)).status, 200, '同一个请求重放回原结果');
    assert.deepEqual(state.memoryDocs.lines.live(YOU_DOC_ID), []);
    assert.ok(state.memoryDocs.lines.get(added.id)?.deletedAt !== null);
    assert.equal((await undo(json(undoneAdd))).status, 409, '撤销过的不能再撤销');

    assert.equal((await undo(changes[1] ?? {})).status, 200);
    assert.deepEqual(state.memoryDocs.lines.live(RULES_DOC_ID).filter((row) => row.basis !== 'system')
      .map((row) => row.text), ['重要的事再发邮件兜底']);

    const chose = await call(app, 'POST', `/v2/memory/dreams/changes/${String(changes[2]?.['id'])}/choose`,
      { cookie, body: { requestId: newRequestId(), version: changes[2]?.['version'], choice: 1 } });
    assert.equal(chose.status, 200);
    assert.equal(json(chose)['chosen'], 1);
    assert.ok(state.memoryDocs.lines.live(RULES_DOC_ID).some((row) => row.text === '悬赏先挂网站'));
    const noAuth = await call(app, 'POST', `/v2/memory/dreams/changes/${String(changes[3]?.['id'])}/undo`,
      { body: { requestId: newRequestId(), version: 1 } });
    assert.equal(noAuth.status, 401);
  });
