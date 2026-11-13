// 技能页的「添加」和「新建」接口（11-13）：商店清单、装之前先看、装、让 Plasticine 写草稿、存自己写的。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const DOC = '---\nname: meeting-notes\ntitle: "会议纪要"\ndescription: 收到会议转写要整理成纪要的时候\n---\n\n1. 通读转写。\n';
const RAW = 'https://raw.githubusercontent.com/AaronMYL/plasticine/main/skills-store';
const INDEX = { version: 1, skills: [{ name: 'meeting-notes', title: '会议纪要', description: '把会议转写整理成纪要',
  category: '办公', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md'] },
{ name: 'sheet-cleanup', title: '表格清洗', description: '把乱的表格整理干净', category: '办公', source: 'community',
  updatedAt: '2026-11-10', files: ['SKILL.md', 'scripts/clean.py'] }] };
const PAGES: Record<string, string> = { [`${RAW}/index.json`]: JSON.stringify(INDEX),
  [`${RAW}/meeting-notes/SKILL.md`]: DOC };

let t: TestApp | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

async function started(steps: Parameters<typeof startTestApp>[0] = []): Promise<{ t: TestApp; cookie: string }> {
  t = await startTestApp(steps, { startTasks: false, skillShop: { fetchText: async (url) => {
    const page = PAGES[url];
    if (page === undefined) { throw new Error('假的网里没有这一页'); }
    return page;
  } } });
  return { t, cookie: await pair(t) };
}

test('商店清单：标出带脚本的和已经装了的；先看再装；装了以后目录里有它，写着从商店来的', async () => {
  const { t: app, cookie } = await started();
  const store = json(await call(app, 'GET', '/v2/skill-store', { cookie }))['skills'] as Array<Record<string, unknown>>;
  assert.deepEqual(store.map((skill) => [skill['name'], skill['scripts'], skill['installed']]),
    [['meeting-notes', false, false], ['sheet-cleanup', true, false]]);
  const from = { kind: 'store', name: 'meeting-notes' };
  const preview = json(await call(app, 'POST', '/v2/skill-preview', { cookie, body: { from } }))['preview'] as
    Record<string, unknown>;
  assert.equal(preview['title'], '会议纪要');
  assert.match(String(preview['text']), /通读转写/);
  const installed = await call(app, 'POST', '/v2/skill-install',
    { cookie, body: { requestId: 'install-req-0001', from } });
  assert.equal(installed.status, 201, JSON.stringify(installed.body));
  const row = json(installed)['skill'] as Record<string, unknown>;
  assert.equal(row['title'], '会议纪要');
  const source = row['source'] as Record<string, unknown>;
  assert.deepEqual([source['kind'], source['origin']],
    ['installed', 'store:meeting-notes']);
  const listed = json(await call(app, 'GET', '/v2/skills?query=meeting', { cookie }))['skills'] as unknown[];
  assert.equal(listed.length, 1);
  const again = json(await call(app, 'GET', '/v2/skill-store', { cookie }))['skills'] as Array<Record<string, unknown>>;
  assert.equal(again[0]?.['installed'], true);
});

test('已经有同名的：不说要换就是 409；说了换，旧的留底；和随应用的重名不让装', async () => {
  const { t: app, cookie } = await started();
  const from = { kind: 'files', files: [{ path: 'SKILL.md', content: DOC }] };
  assert.equal((await call(app, 'POST', '/v2/skill-install', { cookie,
    body: { requestId: 'install-req-0002', from } })).status, 201);
  const clash = await call(app, 'POST', '/v2/skill-install', { cookie, body: { requestId: 'install-req-0003', from } });
  assert.equal(clash.status, 409);
  const changed = { kind: 'files', files: [{ path: 'SKILL.md', content: DOC.replace('通读转写', '先听录音') }] };
  const replaced = await call(app, 'POST', '/v2/skill-install', { cookie,
    body: { requestId: 'install-req-0004', from: changed, replace: true } });
  assert.equal(replaced.status, 201, JSON.stringify(replaced.body));
  const text = json(await call(app, 'GET', '/v2/skills/meeting-notes', { cookie }))['skill'] as Record<string, unknown>;
  assert.match(String(text['text']), /先听录音/);
  const guide = { kind: 'files', files: [{ path: 'SKILL.md',
    content: '---\nname: plasticine-guide\ndescription: 冒名的\n---\n正文\n' }] };
  const builtin = await call(app, 'POST', '/v2/skill-install',
    { cookie, body: { requestId: 'install-req-0005', from: guide } });
  assert.equal(builtin.status, 409);
  assert.match(String(json(builtin)['error']), /随应用提供的技能重名/);
});

test('商店连不上：502 和一句原因；文件不合规：400', async () => {
  const { t: app, cookie } = await started();
  const missing = await call(app, 'POST', '/v2/skill-preview', { cookie,
    body: { from: { kind: 'url', url: 'https://example.org/nope/SKILL.md' } } });
  assert.equal(missing.status, 502);
  const bad = await call(app, 'POST', '/v2/skill-preview', { cookie,
    body: { from: { kind: 'files', files: [{ path: 'readme.md', content: '不是技能' }] } } });
  assert.equal(bad.status, 400);
  assert.match(String(json(bad)['error']), /没有 SKILL\.md/);
});

test('新建：让 Plasticine 写草稿（不存），改完再存；存下的写着是自己写的', async () => {
  const draftText = JSON.stringify({ title: '旅行计划', name: 'trip-plan', description: '要排行程的时候',
    body: '1. 先问去几天、几个人。\n2. 按天排。' });
  const { t: app, cookie } = await started([draftText]);
  const empty = await call(app, 'POST', '/v2/skill-draft', { cookie, body: {} });
  assert.equal(empty.status, 400);
  const drafted = await call(app, 'POST', '/v2/skill-draft', { cookie, body: { said: '每次出门帮我按天排行程' } });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
  const draft = json(drafted)['draft'] as Record<string, string>;
  assert.equal(draft['name'], 'trip-plan');
  assert.match(String(app.requests.at(-1)?.messages.at(-1)?.content), /用户说：每次出门帮我按天排行程/);
  assert.equal((json(await call(app, 'GET', '/v2/skills?query=trip', { cookie }))['skills'] as unknown[]).length, 0);
  const created = await call(app, 'POST', '/v2/skills', { cookie,
    body: { requestId: 'create-req-0001', ...draft, body: `${draft['body']}\n3. 给他看了再订。` } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const row = json(created)['skill'] as Record<string, unknown>;
  assert.deepEqual([row['title'], (row['source'] as Record<string, unknown>)['origin']], ['旅行计划', 'user']);
  const page = json(await call(app, 'GET', '/v2/skills/trip-plan', { cookie }))['skill'] as Record<string, unknown>;
  assert.match(String(page['text']), /给他看了再订/);
  const twice = await call(app, 'POST', '/v2/skills', { cookie, body: { requestId: 'create-req-0002', ...draft } });
  assert.equal(twice.status, 409);
});

test('从做成过的事里整理：把那条线的标题、结论和经过交给模型', async () => {
  const draftText = JSON.stringify({ title: '周报整理', name: 'weekly-digest', description: '每周五整理周报',
    body: '1. 先核实来源。' });
  const { t: app, cookie } = await started([draftText]);
  const line = app.state.lines.create({ kind: 'background', parentLineId: null, projectId: null,
    title: '整理这周的周报' });
  app.state.lineMessages.append(line.id, 'user', { role: 'user', content: '把这周信息流整理成周报，先核实来源' });
  app.state.lineMessages.append(line.id, 'assistant', { role: 'assistant',
    content: [{ type: 'text', text: '核实了 6 条来源，按主题归并成 3 节。' }] });
  const drafted = await call(app, 'POST', '/v2/skill-draft', { cookie, body: { lineId: line.id } });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
  const asked = String(app.requests.at(-1)?.messages.at(-1)?.content);
  assert.match(asked, /已经做成的一件事（资料）：整理这周的周报/);
  assert.match(asked, /交代：把这周信息流整理成周报/);
  assert.match(asked, /Plasticine：核实了 6 条来源/);
  assert.equal((await call(app, 'POST', '/v2/skill-draft', { cookie, body: { lineId: 'no-such-line' } })).status, 404);
});
