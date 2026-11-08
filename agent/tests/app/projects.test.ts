import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { STANDING_PROJECT_IDS } from '../../shared/state.ts';
import { addLine, ensureProjectDoc } from '../../src/brain/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

async function start(): Promise<{ t: TestApp; cookie: string }> {
  t = await startTestApp();
  return { t, cookie: await pair(t) };
}

async function newProject(app: TestApp, cookie: string, extra: Body = {}): Promise<Body> {
  const body = { requestId: newRequestId('proj'), name: 'Cyber Hunter', due: '2026-11-05', ...extra };
  const reply = await call(app, 'POST', '/v2/projects', { cookie, body });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return json(reply)['project'] as Body;
}

test('项目列表：没登录 401；常驻的 Plasticine、个人排最后；没有「还没归项目」那一栏了', async () => {
  const { t: app, cookie } = await start();
  assert.equal((await call(app, 'GET', '/v2/projects')).status, 401);
  await newProject(app, cookie);
  const list = json(await call(app, 'GET', '/v2/projects?tz=Asia/Shanghai', { cookie }));
  const rows = list['projects'] as Body[];
  assert.deepEqual(rows.map((row) => row['name']), ['Cyber Hunter', 'Plasticine', '个人']);
  assert.equal(rows.at(-1)?.['standing'], true);
  assert.equal(list['unfiled'], undefined);
  assert.equal((await call(app, 'GET', '/v2/projects?includeDone=maybe', { cookie })).status, 400);
});

test('截止按用户时区算还有几天；过了截止算逾期，七天内算本周到期', async () => {
  const { t: app, cookie } = await start();
  const today = app.clock.now();
  const day = (offset: number): string => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  await newProject(app, cookie, { name: '过期的', due: day(-3) });
  await newProject(app, cookie, { name: '这周的', due: day(2) });
  const list = json(await call(app, 'GET', '/v2/projects?tz=UTC', { cookie }));
  const rows = list['projects'] as Body[];
  assert.equal(rows.find((row) => row['name'] === '过期的')?.['dueInDays'], -3);
  assert.deepEqual(list['summary'], { active: 4, overdue: 1, dueThisWeek: 1 });
});

test('待办：加一条 201 带期限和还有几天；勾掉、改期限；没做完的排前面；删掉；详情里带上这个项目的线', async () => {
  const { t: app, cookie } = await start();
  const project = await newProject(app, cookie);
  const id = String(project['id']);
  const add = (title: string, due?: string) => call(app, 'POST', `/v2/projects/${id}/todos`, { cookie,
    body: { requestId: newRequestId('todo'), title, ...(due === undefined ? {} : { due }) } });
  const first = await add('交房租', '2026-11-10');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const todo = json(first)['todo'] as Body;
  assert.equal(todo['due'], '2026-11-10');
  assert.equal(typeof todo['dueInDays'], 'number');
  await add('买菜');
  const done = await call(app, 'PUT', `/v2/projects/${id}/todos/${String(todo['id'])}`, { cookie,
    body: { requestId: newRequestId('done'), done: true } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.notEqual((json(done)['todo'] as Body)['doneAt'], null);
  assert.equal((json(done)['project'] as Body)['todosDone'], 1);
  app.state.lines.create({ kind: 'background', parentLineId: null, projectId: id, title: '查渠道' });
  const detail = json(await call(app, 'GET', `/v2/projects/${id}`, { cookie }));
  assert.deepEqual((detail['todos'] as Body[]).map((row) => row['title']), ['买菜', '交房租']);
  assert.deepEqual((detail['lines'] as Body[]).map((row) => row['title']), ['查渠道']);
  assert.deepEqual([detail['nodes'], detail['concerns'], detail['tasks']], [undefined, undefined, undefined]);
  const missing = await call(app, 'PUT', `/v2/projects/${id}/todos/nope`, { cookie,
    body: { requestId: newRequestId('miss'), done: true } });
  assert.equal(missing.status, 404);
  const removed = await call(app, 'POST', `/v2/projects/${id}/items/remove`, { cookie,
    body: { requestId: newRequestId('rm'), targetType: 'todo', targetId: String(todo['id']) } });
  assert.equal(removed.status, 200);
  assert.equal(app.state.projects.items.get(String(todo['id'])), undefined);
  assert.equal((await call(app, 'GET', '/v2/projects/nope', { cookie })).status, 404);
});

test('健康度只由用户写：采纳提议后提议清掉，动态里记「你说的」；重放不重复记', async () => {
  const { t: app, cookie } = await start();
  const project = await newProject(app, cookie);
  const id = String(project['id']);
  const proposed = { value: 'risk' as const, reason: '登记速度跟不上', at: app.clock.now().toISOString() };
  const stored = app.state.projects.update(id, Number(project['version']), { proposedHealth: proposed });
  const body = { requestId: newRequestId('health'), version: stored.version, value: 'risk' };
  const first = await call(app, 'POST', `/v2/projects/${id}/health`, { cookie, body });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await call(app, 'POST', `/v2/projects/${id}/health`, { cookie, body });
  assert.equal(again.status, 200);
  const row = json(first)['project'] as Body;
  assert.equal(row['health'], 'risk');
  assert.equal(row['proposedHealth'], null);
  const activity = json(await call(app, 'GET', `/v2/projects/${id}`, { cookie }))['activity'] as Body[];
  const healthLines = activity.filter((line) => String(line['text']).startsWith('健康度'));
  assert.equal(healthLines.length, 1);
  assert.equal(healthLines[0]?.['source'], 'user');
  const stale = await call(app, 'POST', `/v2/projects/${id}/health`, { cookie,
    body: { requestId: newRequestId('stale'), version: 1, value: 'ok' } });
  assert.equal(stale.status, 409);
});

test('编辑：常驻项目不能完成；现状记成你写的；档案和分工原样存', async () => {
  const { t: app, cookie } = await start();
  const personal = app.state.projects.require(STANDING_PROJECT_IDS.personal);
  const done = await call(app, 'PUT', `/v2/projects/${personal.id}`, { cookie,
    body: { requestId: newRequestId('done'), version: personal.version, lifecycle: 'done' } });
  assert.equal(done.status, 409);
  const project = await newProject(app, cookie);
  const id = String(project['id']);
  const brief = { goal: '人和私人 AI 之间的任务平台', constraints: '运营不放国内', rules: '每条帖先弹框', terms: '' };
  const edit = await call(app, 'PUT', `/v2/projects/${id}`, { cookie, body: { requestId: newRequestId('edit'),
    version: project['version'], status: '登记 3 / 10', brief, people: [{ who: '你', does: '产品与运营' }] } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const stored = app.state.projects.require(id);
  assert.equal(stored.status?.by, 'user');
  assert.deepEqual(stored.brief, brief);
  assert.equal(stored.people[0]?.who, '你');
});

test('归档：链接要完整地址；笔记挪进来，拿出来不动笔记本身', async () => {
  const { t: app, cookie } = await start();
  const project = await newProject(app, cookie);
  const id = String(project['id']);
  const bad = await call(app, 'POST', `/v2/projects/${id}/items`, { cookie,
    body: { requestId: newRequestId('bad'), targetType: 'link', targetId: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  const link = await call(app, 'POST', `/v2/projects/${id}/items`, { cookie, body: { requestId: newRequestId('link'),
    targetType: 'link', targetId: 'https://github.com/example/plasticine', title: 'GitHub · plasticine' } });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const note = app.state.notes.create({ markdown: '# 国内转载走哪个渠道', author: 'user', folder: '笔记' });
  const fileBody = { requestId: newRequestId('file'), targetType: 'note', targetId: note.id };
  assert.equal((await call(app, 'POST', `/v2/projects/${id}/items`, { cookie, body: fileBody })).status, 200);
  const materials = json(await call(app, 'GET', `/v2/projects/${id}`, { cookie }))['materials'] as Body[];
  assert.equal(materials[0]?.['title'], 'GitHub · plasticine');
  const removeBody = { requestId: newRequestId('rm'), targetType: 'note', targetId: note.id };
  assert.equal((await call(app, 'POST', `/v2/projects/${id}/items/remove`, { cookie, body: removeBody })).status, 200);
  assert.notEqual(app.state.notes.get(note.id), undefined);
  const missing = await call(app, 'POST', `/v2/projects/${id}/items`, { cookie,
    body: { requestId: newRequestId('miss'), targetType: 'note', targetId: 'note_none' } });
  assert.equal(missing.status, 404);
});

test('档案里的决定带着原话：详情的 decisions 每条指回他说定的那句（line:<线>:<序号>），改过的只给现在的', async () => {
  const { t: app, cookie } = await start();
  const project = await newProject(app, cookie);
  const id = String(project['id']);
  const said = app.state.lineMessages.append('line-main', 'user', { role: 'user', content: '中继放腾讯云', timestamp: 1 });
  const stored = app.state.projects.require(id);
  const doc = ensureProjectDoc(app.state, stored);
  addLine(app.state, { docId: doc.id, section: 'decision', text: '中继：放腾讯云，只转加密字节', basis: 'stated',
    anchors: [{ kind: 'message', ref: `line:line-main:${said.seq}` }] }, { actor: 'brain', ref: null });
  const detail = json(await call(app, 'GET', `/v2/projects/${id}`, { cookie }));
  assert.deepEqual((detail['decisions'] as Body[]).map((row) => [row['text'], row['quoteRef']]),
    [['中继：放腾讯云，只转加密字节', `line:line-main:${said.seq}`]]);
});
